package main

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/config"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/logging"
	billingusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/billing/usecase"
	bulkusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/bulk/usecase"
	contractsusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/contracts/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/dailysummary"
	dsusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/dailysummary/usecase"
	exportusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/exports/usecase"
	importusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/imports/usecase"
	logsusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/logs/usecase"
	messagingmodule "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/messaging"
	messagingusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/messaging/usecase"
	notifmodule "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/notifications"
	notifmodel "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/notifications/model"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/notifications/providers"
	notifusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/notifications/usecase"
	centerusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/notifycenter/usecase"
	quotesusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/quotes/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/salesflow"
	todosusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/todos/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/vehiclealerts"
	vausecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/vehiclealerts/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/observability"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/activity"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/bulkengine"
	bulkadapters "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/bulkengine/adapters"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/entitlements"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/events"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/ioengine"
	ioadapters "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/ioengine/adapters"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/mail"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/outbox"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/pdfrender"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/rbac"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/searchengine"
	searchadapters "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/searchengine/adapters"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/storage"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/queue"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/realtime"
	"github.com/jackc/pgx/v5/pgxpool"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		_, _ = os.Stderr.WriteString("config load failed: " + err.Error() + "\n")
		os.Exit(1)
	}

	log := logging.New(cfg.Log.Level, cfg.Log.Format)
	flushSentry, err := observability.Init(cfg.Sentry, "worker")
	if err != nil {
		log.Warn("sentry_init_failed", "error", err)
	} else if observability.Enabled() {
		log.Info("sentry_enabled", "environment", cfg.Sentry.Environment, "traces_sample_rate", cfg.Sentry.TracesSampleRate)
	}
	defer flushSentry()
	// exit flushes pending error events before leaving (os.Exit skips defers).
	exit := func(code int) {
		flushSentry()
		os.Exit(code)
	}
	log = slog.New(observability.NewSlogHandler(log.Handler()))
	if !cfg.Queue.Enabled {
		log.Error("queue_disabled")
		exit(1)
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	pool, err := database.NewPostgresPool(ctx, cfg.DB)
	if err != nil {
		log.Error("database_init_failed", "error", err)
		exit(1)
	}
	defer pool.Close()

	store, err := storage.NewFromConfig(ctx, cfg.Storage)
	if err != nil {
		log.Error("storage_init_failed", "error", err)
		exit(1)
	}

	var publisher realtime.Publisher
	if cfg.Centrifugo.Enabled {
		publisher = realtime.NewCentrifugoClient(cfg.Centrifugo)
	} else {
		publisher = realtime.NoopPublisher{}
	}

	queries := database.NewQueries(pool)
	mailer := mail.NewSMTPSender(cfg.SMTP)
	provs := []providers.Provider{
		providers.InappProvider{},
		providers.EmailProvider{Mail: mailer},
		providers.RealtimeProvider{Pub: publisher},
		providers.NoopProvider{Name: "sms", Log: log},
		providers.NoopProvider{Name: "push", Log: log},
	}
	notifSvc := notifusecase.New(queries, nil, provs, log)
	notifSvc.WithVAPID(notifusecase.VAPIDConfig{
		PublicKey:  cfg.VAPID.PublicKey,
		PrivateKey: cfg.VAPID.PrivateKey,
		Subject:    cfg.VAPID.Subject,
	})
	notifSvc.WithExpo(notifusecase.ExpoConfig{AccessToken: cfg.Expo.AccessToken})

	eventBus := events.NewBus(log)
	notifmodule.RegisterEventHandlers(eventBus, notifSvc, log)
	outboxStore := outbox.NewStore(pool, queries)
	outboxPub := outbox.NewPublisher(outboxStore, eventBus, log)
	outboxStop := outboxPub.StartRun(ctx)
	defer outboxStop()

	activityRec := activity.NewRecorder(queries, log)
	ioReg := ioengine.NewRegistry(
		ioadapters.NewUsers(queries),
		ioadapters.NewRoles(queries),
		ioadapters.NewNotifications(queries),
		ioadapters.NewActivity(queries),
		ioadapters.NewFinanceAccounts(queries),
		ioadapters.NewFinanceCategories(queries),
		ioadapters.NewFinanceTransactions(queries),
		ioadapters.NewCatalogProducts(queries),
		ioadapters.NewCatalogServices(queries),
		ioadapters.NewCatalogCategories(queries),
		ioadapters.NewCariAccounts(queries),
		ioadapters.NewCariEntries(queries),
		ioadapters.NewJobs(queries),
		ioadapters.NewSales(queries),
		ioadapters.NewSuppliers(queries),
		ioadapters.NewPurchases(queries),
		ioadapters.NewReports(queries),
	)
	exportSvc := exportusecase.New(queries, store, ioReg, nil, notifSvc, activityRec, log)
	exportSvc.SetDocumentPDF(pdfrender.New(cfg.Gotenberg.URL))
	importSvc := importusecase.New(queries, store, ioReg, nil, notifSvc, activityRec, log)
	catalogProductsBulk := bulkadapters.NewCatalogProducts(queries)
	catalogServicesBulk := bulkadapters.NewCatalogServices(queries)
	bulkReg := bulkengine.NewRegistry(
		bulkadapters.NewUsers(queries),
		bulkadapters.NewRoles(queries),
		catalogProductsBulk,
		catalogServicesBulk,
	)
	bulkSvc := bulkusecase.New(queries, bulkReg, nil, notifSvc, activityRec, cfg.Bulk, log)
	logsSvc := logsusecase.New(queries)
	pdfClient := pdfrender.New(cfg.Gotenberg.URL)
	contractsPublicURL := cfg.Storage.MinIO.PublicBaseURL
	if strings.EqualFold(cfg.Storage.Driver, "s3") {
		contractsPublicURL = cfg.Storage.S3.PublicBaseURL
	}
	contractsSvc := contractsusecase.New(pool, queries, activityRec, store, pdfClient, nil, contractsPublicURL)
	quotesSvc := quotesusecase.New(pool, queries, activityRec, store, pdfClient, cfg.Auth.FrontendURL)
	quotesSvc.SetLogger(log)
	searchReg := searchengine.NewRegistry(
		searchadapters.NewUsers(queries),
		searchadapters.NewRoles(queries),
		searchadapters.NewFinanceAccounts(queries),
		searchadapters.NewFinanceCategories(queries),
		searchadapters.NewFinanceTransactions(queries),
		searchadapters.NewCatalogProducts(queries),
		searchadapters.NewCatalogServices(queries),
		searchadapters.NewVehicleModelYears(queries),
		searchadapters.NewCariAccounts(queries),
		searchadapters.NewJobs(queries),
		searchadapters.NewSales(queries),
		searchadapters.NewSuppliers(queries),
		searchadapters.NewPurchases(queries),
	)
	searchClient := searchengine.NewClient(cfg.Search, log)
	searchIndexer := searchengine.NewIndexer(searchClient, searchReg, nil, log)
	catalogProductsBulk.SetSearchIndexer(searchIndexer)
	catalogServicesBulk.SetSearchIndexer(searchIndexer)
	// Notification center: the sweep runs here; WhatsApp/SMS sends are queued
	// to the API process (owner of the WhatsApp sessions) via QueueMessaging.
	queueClient := queue.NewClient(cfg.Redis)
	defer func() { _ = queueClient.Close() }()
	// Deliveries run inline here; mobile pushes go through the queue (retries).
	notifSvc.WithPushQueue(queueClient)
	messagingSvc := messagingusecase.New(queries, nil, nil).SetQueue(queueClient).SetStorage(store)
	centerMessenger := messagingmodule.NewCenterMessenger(messagingSvc, queries)
	dailySummarySvc := dsusecase.New(queries, dailysummary.NewMessagingSender(messagingSvc), log)
	vehicleAlertsSvc := vausecase.New(queries, dailysummary.NewMessagingSender(messagingSvc), vehiclealerts.NewInAppNotifier(notifSvc), log)
	entitlementsSvc := entitlements.New(entitlements.NewDBStore(queries))
	billingSvc := billingusecase.New(pool, queries, activityRec, entitlementsSvc)
	billingSvc.SetNotifier(&workerBillingNotifier{pool: pool, notifications: notifSvc, log: log})
	messagingSvc.SetEntitlements(entitlementsSvc)
	entitlementsRecomputer := entitlements.NewRecomputer(queries, entitlementsSvc)
	centerSvc := centerusecase.New(queries, notifSvc, centerMessenger, log).
		SetStorage(store).
		SetAppURL(cfg.Auth.FrontendURL)
	centerSvc.RegisterGuard("todo", todosusecase.New(queries, nil).ReminderGuard)
	billingSvc.SetOwnerAlerts(centerSvc, cfg.Auth.FrontendURL)
	entitlementsSvc.SetAlerter(billingSvc)
	// Quote reminders fire from this sweep: same preparer / sent hook as the
	// API; expiry cancels their scheduled notifications.
	sales := salesflow.New(centerSvc, centerMessenger, queries, log)
	sales.Register(centerSvc)
	sales.SetQuotes(quotesSvc)
	quotesSvc.SetReminderScheduler(sales)
	quotesSvc.SetNotifier(sales)

	persist := logging.Attach(log, logsSvc)
	log = persist.Logger()
	defer persist.Close()

	worker := queue.NewWorker(cfg, log, notifSvc.Deliver).
		WithExport(exportSvc.ProcessExport).
		WithImport(importSvc.ProcessImport).
		WithBulk(bulkSvc.ProcessBulk).
		WithLogPurge(logsSvc.ApplyDueRules).
		WithContractExecute(contractsSvc.ExecutePDF).
		WithReminderSweep(centerSvc.ProcessDue).
		WithQuoteExpire(quotesSvc.ExpireDue).
		WithDailySummary(dailySummarySvc.SendDue).
		WithVehicleAlerts(vehicleAlertsSvc.Flush).
		WithBillingRecompute(entitlementsRecomputer.RecomputeAll).
		WithBillingOrdersExpire(billingSvc.ExpireDueOrders).
		WithBillingLifecycle(func(ctx context.Context, now time.Time) (queue.BillingLifecycleResult, error) {
			res, err := billingSvc.RunLifecycle(ctx, now)
			return queue.BillingLifecycleResult{
				MovedToGrace: res.MovedToGrace, MovedToReadOnly: res.MovedToReadOnly,
				RemindersSent: res.RemindersSent, OrderRemindersSent: res.OrderRemindersSent,
			}, err
		}).
		WithBillingDigest(billingSvc.SendAdminDigest).
		WithMobilePush(notifSvc.SendMobilePush, notifSvc.ProcessPushReceipts).
		WithSearch(
			searchIndexer.ProcessUpsert,
			searchIndexer.ProcessDelete,
			searchIndexer.ProcessReindex,
		)

	if searchIndexer.Enabled() {
		go searchIndexer.Bootstrap(ctx)
	}

	scheduler, err := queue.StartLogPurgeScheduler(cfg, log)
	if err != nil {
		log.Error("log_purge_scheduler_failed", "error", err)
		exit(1)
	}
	if err := queue.RegisterReminderSweep(scheduler, log); err != nil {
		log.Error("reminder_scheduler_failed", "error", err)
		exit(1)
	}
	if err := queue.RegisterQuoteExpirySchedule(scheduler); err != nil {
		log.Error("quote_expiry_scheduler_failed", "error", err)
		exit(1)
	}
	if err := queue.RegisterDailySummarySchedule(scheduler); err != nil {
		log.Error("daily_summary_scheduler_failed", "error", err)
		exit(1)
	}
	if err := queue.RegisterVehicleAlertsSchedule(scheduler); err != nil {
		log.Error("vehicle_alerts_scheduler_failed", "error", err)
		exit(1)
	}
	if err := queue.RegisterBillingRecomputeSchedule(scheduler); err != nil {
		log.Error("billing_recompute_scheduler_failed", "error", err)
		exit(1)
	}
	if err := queue.RegisterBillingOrdersExpireSchedule(scheduler); err != nil {
		log.Error("billing_orders_expire_scheduler_failed", "error", err)
		exit(1)
	}
	if err := queue.RegisterBillingLifecycleSchedule(scheduler); err != nil {
		log.Error("billing_lifecycle_scheduler_failed", "error", err)
		exit(1)
	}
	if err := queue.RegisterBillingDigestSchedule(scheduler); err != nil {
		log.Error("billing_digest_scheduler_failed", "error", err)
		exit(1)
	}
	if err := queue.RegisterPushReceiptsSchedule(scheduler); err != nil {
		log.Error("push_receipts_scheduler_failed", "error", err)
		exit(1)
	}
	go func() {
		if err := scheduler.Run(); err != nil {
			log.Error("log_purge_scheduler_stopped", "error", err)
		}
	}()
	// Counters only move through the module hooks; rebuild them once at boot
	// so a fresh deploy (or the 000064 backfill) starts from real numbers.
	go func() {
		if n, err := entitlementsRecomputer.RecomputeAll(ctx); err != nil {
			log.Error("billing_recompute_boot_failed", "error", err)
		} else {
			log.Info("billing_recompute_boot", "organizations", n)
		}
	}()
	go func() {
		res, err := billingSvc.RunLifecycle(ctx, time.Now().UTC())
		if err != nil {
			log.Error("billing_lifecycle_boot_failed", "error", err)
			return
		}
		log.Info("billing_lifecycle_boot", "grace", res.MovedToGrace, "read_only", res.MovedToReadOnly, "reminders", res.RemindersSent)
	}()

	log.Info(
		"worker_started",
		"app", cfg.App.Name,
		"env", cfg.App.Env,
		"concurrency", cfg.Queue.Concurrency,
	)

	if n, err := notifSvc.ReclaimStuck(ctx, notifusecase.DefaultStuckProcessingMinutes); err != nil {
		log.Error("notification_reclaim_failed", "error", err)
	} else if n > 0 {
		log.Info("notification_reclaim_completed", "count", n)
	}

	errCh := make(chan error, 1)
	go func() {
		errCh <- worker.Start()
	}()

	select {
	case <-ctx.Done():
		log.Info("worker_shutdown_signal")
		worker.Shutdown()
	case err := <-errCh:
		if err != nil {
			log.Error("worker_failed", "error", err)
			exit(1)
		}
	}
	log.Info("worker_stopped")
}

type workerBillingNotifier struct {
	pool          *pgxpool.Pool
	notifications *notifusecase.Service
	log           *slog.Logger
}

func (n *workerBillingNotifier) NotifyOrganization(ctx context.Context, orgID int64, title, body, link string) {
	n.notifyOrganization(ctx, orgID, title, body, link, []string{notifmodel.ChannelInapp})
}

func (n *workerBillingNotifier) NotifyOrganizationEmail(ctx context.Context, orgID int64, title, body, link string) {
	n.notifyOrganization(ctx, orgID, title, body, link, []string{notifmodel.ChannelInapp, notifmodel.ChannelEmail})
}

func (n *workerBillingNotifier) NotifyPlatform(ctx context.Context, title, body, link string) {
	if n == nil || n.pool == nil || n.notifications == nil {
		return
	}
	rows, err := n.pool.Query(ctx, `
		SELECT DISTINCT u.id
		FROM users u
		JOIN user_roles ur ON ur.user_id = u.id
		JOIN roles r ON r.id = ur.role_id
		LEFT JOIN role_permissions rp ON rp.role_id = r.id
		LEFT JOIN permissions p ON p.id = rp.permission_id
		WHERE u.deleted_at IS NULL AND (r.slug = 'super_admin' OR p.slug = $1)
	`, rbac.PermPlatformBillingWrite)
	if err != nil {
		n.log.Warn("billing_notify_platform_recipients_failed", "error", err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		var userID int64
		if err := rows.Scan(&userID); err != nil {
			n.log.Warn("billing_notify_platform_scan_failed", "error", err)
			continue
		}
		n.enqueue(ctx, userID, title, body, link, []string{notifmodel.ChannelInapp})
	}
}

func (n *workerBillingNotifier) notifyOrganization(ctx context.Context, orgID int64, title, body, link string, channels []string) {
	if n == nil || n.pool == nil || n.notifications == nil {
		return
	}
	rows, err := n.pool.Query(ctx, `
		SELECT DISTINCT u.id
		FROM organization_members om
		JOIN users u ON u.id = om.user_id AND u.deleted_at IS NULL
		WHERE om.organization_id = $1 AND om.role = 'owner'
	`, orgID)
	if err != nil {
		n.log.Warn("billing_notify_org_recipients_failed", "org_id", orgID, "error", err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		var userID int64
		if err := rows.Scan(&userID); err != nil {
			n.log.Warn("billing_notify_org_scan_failed", "org_id", orgID, "error", err)
			continue
		}
		n.enqueue(ctx, userID, title, body, link, channels)
	}
}

func (n *workerBillingNotifier) enqueue(ctx context.Context, userID int64, title, body, link string, channels []string) {
	action := link
	if action == "" {
		action = "/platform/billing"
	}
	if _, err := n.notifications.Enqueue(ctx, notifmodel.EnqueueInput{
		UserID:      &userID,
		Channels:    channels,
		Priority:    notifmodel.PriorityHigh,
		Title:       title,
		Body:        body,
		ActionURL:   &action,
		SourceEvent: "billing",
		Language:    "tr",
	}); err != nil && n.log != nil {
		n.log.Warn("billing_notify_enqueue_failed", "user_id", userID, "error", err)
	}
}
