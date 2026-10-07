package httpserver

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/cache"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/config"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/middleware"
	accessmodule "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/access"
	accesshandler "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/access/handler"
	activitymodule "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/activity"
	activityhandler "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/activity/handler"
	activityusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/activity/usecase"
	aimodule "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/ai"
	aihandler "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/ai/handler"
	aitools "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/ai/tools"
	aiusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/ai/usecase"
	authmodule "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/auth"
	authhandler "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/auth/handler"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/auth/identity"
	authrepo "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/auth/repository"
	authusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/auth/usecase"
	authsettingsmodule "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/authsettings"
	authsettingshandler "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/authsettings/handler"
	authsettingsusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/authsettings/usecase"
	billingmodule "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/billing"
	billingusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/billing/usecase"
	bulkmodule "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/bulk"
	bulkhandler "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/bulk/handler"
	bulkusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/bulk/usecase"
	carimodule "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/cari"
	cariusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/cari/usecase"
	catalogmodule "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/catalog"
	catalogusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/catalog/usecase"
	contractsmodule "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/contracts"
	contractsusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/contracts/usecase"
	customersmodule "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/customers"
	customersusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/customers/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/dailysummary"
	dsusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/dailysummary/usecase"
	exportmodule "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/exports"
	exporthandler "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/exports/handler"
	exportusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/exports/usecase"
	financemodule "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/finance"
	financeusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/finance/usecase"
	importmodule "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/imports"
	importhandler "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/imports/handler"
	importusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/imports/usecase"
	githubmodule "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/integrations/github"
	githubhandler "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/integrations/github/handler"
	githubusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/integrations/github/usecase"
	oauthprovidermodule "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/integrations/oauthprovider"
	oauthproviderhandler "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/integrations/oauthprovider/handler"
	oauthproviderusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/integrations/oauthprovider/usecase"
	platformwhatsappmodule "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/integrations/whatsapp"
	platformwhatsapphandler "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/integrations/whatsapp/handler"
	platformwhatsappusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/integrations/whatsapp/usecase"
	jobsmodule "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/jobs"
	jobsusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/jobs/usecase"
	leadsmodule "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/leads"
	leadsusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/leads/usecase"
	logsmodule "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/logs"
	logshandler "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/logs/handler"
	logsusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/logs/usecase"
	messagingmodule "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/messaging"
	messagingcatalog "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/messaging/catalog"
	messagingcloud "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/messaging/cloud"
	messagingmodel "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/messaging/model"
	messagingproviders "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/messaging/providers"
	messagingusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/messaging/usecase"
	notifmodule "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/notifications"
	notifhandler "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/notifications/handler"
	notifmodel "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/notifications/model"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/notifications/providers"
	notifusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/notifications/usecase"
	notifycentermodule "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/notifycenter"
	centerusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/notifycenter/usecase"
	orgmodule "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/organizations"
	orgusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/organizations/usecase"
	purchasesmodule "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/purchases"
	purchasesusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/purchases/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/qrlogin"
	quotesmodule "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/quotes"
	quotesusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/quotes/usecase"
	reportsmodule "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/reports"
	reportsusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/reports/usecase"
	salesmodule "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/sales"
	salesusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/sales/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/salesflow"
	searchmodule "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/search"
	searchhandler "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/search/handler"
	searchusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/search/usecase"
	settingsmodule "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/settings"
	settingshandler "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/settings/handler"
	settingsusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/settings/usecase"
	staffmodule "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/staff"
	staffusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/staff/usecase"
	storagemodule "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/storage"
	storagehandler "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/storage/handler"
	storageusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/storage/usecase"
	suppliersmodule "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/suppliers"
	suppliersusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/suppliers/usecase"
	todosmodule "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/todos"
	todosusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/todos/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/vehiclealerts"
	vausecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/vehiclealerts/usecase"
	vehiclemodule "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/vehiclecatalog"
	vehiclehandler "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/vehiclecatalog/handler"
	vehicleusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/vehiclecatalog/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/activity"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/appleauth"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/bulkengine"
	bulkadapters "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/bulkengine/adapters"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/crypto"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/entitlements"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/events"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/ioengine"
	ioadapters "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/ioengine/adapters"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/jwt"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/mail"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/oidc"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/outbox"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/pdfrender"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/ratelimit"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/rbac"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/searchengine"
	searchadapters "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/searchengine/adapters"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/stepup"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/storage"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/queue"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/realtime"
	"github.com/hibiken/asynq"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

// Deps holds infrastructure clients wired into the HTTP server.
type Deps struct {
	DB       *pgxpool.Pool
	Queries  *db.Queries
	Redis    *redis.Client
	Queue    *queue.Client
	Storage  storage.Driver
	Realtime realtime.Publisher
	Worker   *queue.Worker
	Events   events.Bus
}

// Server is the HTTP composition root for infrastructure routes.
type Server struct {
	cfg           config.Config
	log           *slog.Logger
	db            *pgxpool.Pool
	queries       *db.Queries
	redis         *redis.Client
	queueClient   *queue.Client
	storage       storage.Driver
	realtime      realtime.Publisher
	worker        *queue.Worker
	msgWorker     *queue.MessagingWorker
	reminderSched *asynq.Scheduler
	// reminderTick runs the notification sweep in-process when the queue is
	// disabled (single-process local setups).
	reminderTick  func(ctx context.Context) error
	reminderStop  context.CancelFunc
	events        events.Bus
	outboxPub     *outbox.Publisher
	outboxStop    func()
	searchClient  *searchengine.Client
	searchIndexer *searchengine.Indexer
	githubSvc     *githubusecase.Service
	oauthProvSvc  *oauthproviderusecase.Service
	authSettings  *authsettingsusecase.Service
	http          *http.Server
}

// New wires router and middleware for the API skeleton.
func New(cfg config.Config, log *slog.Logger, deps Deps) (*Server, error) {
	mux := http.NewServeMux()
	eventBus := deps.Events
	if eventBus == nil {
		eventBus = events.NewBus(log)
	}

	s := &Server{
		cfg:         cfg,
		log:         log,
		db:          deps.DB,
		queries:     deps.Queries,
		redis:       deps.Redis,
		queueClient: deps.Queue,
		storage:     deps.Storage,
		realtime:    deps.Realtime,
		worker:      deps.Worker,
		events:      eventBus,
	}

	mux.HandleFunc("GET /healthz", s.handleHealthz)
	mux.HandleFunc("GET /readyz", s.handleReadyz)
	mux.HandleFunc("GET /v1/app/config", s.handleAppConfig)
	s.mountDocs(mux)

	tokens, err := jwt.NewManager(cfg.JWT.AccessSecret, cfg.JWT.AccessTTL, cfg.JWT.RefreshTTL)
	if err != nil {
		return nil, fmt.Errorf("httpserver: jwt: %w", err)
	}

	mailer := mail.NewSMTPSender(cfg.SMTP)
	provs := []providers.Provider{
		providers.InappProvider{},
		providers.EmailProvider{Mail: mailer},
		providers.RealtimeProvider{Pub: deps.Realtime},
		providers.NoopProvider{Name: "sms", Log: log},
		providers.NoopProvider{Name: "push", Log: log},
	}
	// Pass a nil interface (not a typed-nil *queue.Client) when the queue is
	// disabled so notifications are delivered inline.
	var notifQueue notifusecase.Enqueuer
	if deps.Queue != nil {
		notifQueue = deps.Queue
	}
	notifSvc := notifusecase.New(deps.Queries, notifQueue, provs, log)
	notifSvc.WithActionSigner(cfg.JWT.AccessSecret, 0)
	notifSvc.WithVAPID(notifusecase.VAPIDConfig{
		PublicKey:  cfg.VAPID.PublicKey,
		PrivateKey: cfg.VAPID.PrivateKey,
		Subject:    cfg.VAPID.Subject,
	})
	notifSvc.WithExpo(notifusecase.ExpoConfig{AccessToken: cfg.Expo.AccessToken})

	repo := authrepo.NewPostgres(deps.DB, deps.Queries)
	uc := authusecase.New(repo, tokens)
	uc.SetNotifier(notifSvc)
	uc.SetLogger(log)

	searchReg := searchengine.NewRegistry(
		searchadapters.NewUsers(deps.Queries),
		searchadapters.NewRoles(deps.Queries),
		searchadapters.NewFinanceAccounts(deps.Queries),
		searchadapters.NewFinanceCategories(deps.Queries),
		searchadapters.NewFinanceTransactions(deps.Queries),
		searchadapters.NewCatalogProducts(deps.Queries),
		searchadapters.NewCatalogServices(deps.Queries),
		searchadapters.NewVehicleModelYears(deps.Queries),
		searchadapters.NewCariAccounts(deps.Queries),
		searchadapters.NewJobs(deps.Queries),
		searchadapters.NewSales(deps.Queries),
		searchadapters.NewSuppliers(deps.Queries),
		searchadapters.NewPurchases(deps.Queries),
	)
	searchClient := searchengine.NewClient(cfg.Search, log)
	searchIndexer := searchengine.NewIndexer(searchClient, searchReg, deps.Queue, log)
	s.searchClient = searchClient
	s.searchIndexer = searchIndexer
	uc.SetSearchIndexer(searchIndexer)

	rtIssuer, err := realtime.NewTokenIssuer(cfg.Centrifugo)
	if err != nil {
		return nil, fmt.Errorf("httpserver: realtime tokens: %w", err)
	}
	uc.SetRealtimeHints(authusecase.RealtimeHints{
		Enabled: rtIssuer.Enabled(),
		WSURL:   cfg.Centrifugo.WSURL,
	})

	activityRec := activity.NewRecorder(deps.Queries, log)

	stepUpStore := stepup.NewStore(deps.Redis, cfg.App.Env)
	var stepUpWebAuthn *stepup.WebAuthn
	stepUpOrigins := cfg.CORS.AllowedOrigins
	if len(stepUpOrigins) == 0 {
		stepUpOrigins = []string{strings.TrimRight(cfg.Auth.FrontendURL, "/")}
	}
	if webauthn, err := stepup.NewWebAuthn(stepup.WebAuthnConfig{
		RPID:          cfg.Auth.WebAuthnRPID,
		RPDisplayName: cfg.App.Name,
		RPOrigins:     stepUpOrigins,
	}); err == nil {
		stepUpWebAuthn = webauthn
	} else {
		log.Warn("stepup_webauthn_disabled", "error", err)
	}
	secretBox, err := crypto.NewSecretBox(cfg.Encryption.Key)
	if err != nil {
		return nil, fmt.Errorf("httpserver: encryption: %w", err)
	}
	stepUpSvc := stepup.NewService(deps.Queries, stepUpStore, stepUpWebAuthn, repo)
	stepUpSvc.SetSecretBox(secretBox)

	githubSvc := githubusecase.New(deps.Queries, secretBox)
	platformWhatsAppSvc := platformwhatsappusecase.New(deps.Queries, secretBox, cfg.Auth.FrontendURL)
	oauthProvSvc := oauthproviderusecase.New(deps.Queries, secretBox)
	authSettingsSvc := authsettingsusecase.New(deps.Queries)
	uc.SetAuthSettings(authSettingsSvc)
	uc.SetAccessPolicy(stepUpSvc)
	uc.SetSecretBox(secretBox, cfg.App.Name)
	oauthUC := authusecase.NewOAuth(repo, secretBox)
	uc.SetReviewAccounts(cfg.Auth.ReviewAccounts)
	// Apple signing key: admin-uploaded .p8 (DB) first, AUTH_APPLE_* env fallback.
	appleClient, err := appleauth.NewResolver(oauthProvSvc, appleauth.Config{
		TeamID: cfg.Auth.AppleTeamID, KeyID: cfg.Auth.AppleKeyID, PrivateKey: cfg.Auth.ApplePrivateKey,
	}, nil)
	if err != nil {
		return nil, fmt.Errorf("httpserver: apple sign-in key: %w", err)
	}
	oauthProvSvc.SetAppleKeys(appleClient)
	uc.SetNativeOAuth(authusecase.NativeOAuthConfig{
		Verifier:        oidc.New(oidc.DefaultProviders(), nil),
		Apple:           appleClient,
		Clients:         oauthProvSvc,
		AppleClientIDs:  cfg.Auth.AppleNativeClientIDs,
		GoogleClientIDs: cfg.Auth.GoogleNativeClientIDs,
	})
	s.githubSvc = githubSvc
	s.oauthProvSvc = oauthProvSvc
	s.authSettings = authSettingsSvc

	h := authhandler.New(uc, oauthUC, githubSvc, oauthProvSvc, authSettingsSvc, cfg.Auth.AdapterSecret, stepUpSvc, activityRec)
	h.SetRateLimiter(ratelimit.New(deps.Redis, cfg.App.Env))
	loader := identity.Loader{UC: uc}
	orgSvc := orgusecase.New(deps.DB, deps.Queries)
	uc.SetOrganizationResolver(orgSvc)
	authmodule.RegisterRoutes(mux, h, tokens, loader, stepUpSvc)
	orgmodule.RegisterRoutes(mux, orgSvc, uc, deps.Storage, tokens, loader, deps.Queries, ratelimit.New(deps.Redis, cfg.App.Env))
	financeSvc := financeusecase.New(deps.DB, deps.Queries, activityRec)
	financeSvc.SetSearchIndexer(searchIndexer)
	financemodule.RegisterRoutes(mux, financeSvc, tokens, loader, deps.Queries)
	cariSvc := cariusecase.New(deps.DB, deps.Queries, activityRec, financeSvc)
	cariSvc.SetSearchIndexer(searchIndexer)
	cariSvc.SetEventBus(eventBus)
	carimodule.RegisterRoutes(mux, cariSvc, tokens, loader, deps.Queries)
	entitlementsSvc := entitlements.New(entitlements.NewDBStore(deps.Queries))
	pdfClient := pdfrender.New(cfg.Gotenberg.URL)
	billingSvc := billingusecase.New(deps.DB, deps.Queries, activityRec, entitlementsSvc)
	billingSvc.SetStorage(deps.Storage)
	billingSvc.SetPDFRenderer(pdfClient)
	billingSvc.SetNotifier(&billingNotifier{pool: deps.DB, notifications: notifSvc, log: log})
	if err := billingSvc.EnsureBuiltinFeatures(context.Background()); err != nil {
		log.Warn("billing_builtin_features_failed", "error", err)
	}
	orgSvc.SetTrialStarter(billingSvc)
	billingmodule.RegisterRoutes(mux, billingSvc, tokens, loader, deps.Queries)
	jobsSvc := jobsusecase.New(deps.DB, deps.Queries, activityRec, financeSvc, cariSvc)
	jobsSvc.SetEntitlements(entitlementsSvc)
	jobsSvc.SetSearchIndexer(searchIndexer)
	jobsSvc.SetEventBus(eventBus)
	jobsmodule.RegisterRoutes(mux, jobsSvc, tokens, loader, deps.Queries)
	staffSvc := staffusecase.New(deps.DB, deps.Queries, activityRec)
	staffSvc.SetEntitlements(entitlementsSvc)
	staffmodule.RegisterRoutes(mux, staffSvc, tokens, loader, deps.Queries)
	salesSvc := salesusecase.New(deps.DB, deps.Queries, activityRec, financeSvc, cariSvc)
	salesSvc.SetSearchIndexer(searchIndexer)
	salesSvc.SetEventBus(eventBus)
	salesmodule.RegisterRoutes(mux, salesSvc, tokens, loader, deps.Queries)
	suppliersSvc := suppliersusecase.New(deps.DB, deps.Queries, activityRec)
	suppliersSvc.SetSearchIndexer(searchIndexer)
	suppliersSvc.SetEventBus(eventBus)
	suppliersmodule.RegisterRoutes(mux, suppliersSvc, tokens, loader, deps.Queries)
	contractsSvc := contractsusecase.New(
		deps.DB,
		deps.Queries,
		activityRec,
		deps.Storage,
		pdfClient,
		deps.Queue,
		storagePublicBaseURL(cfg.Storage),
	)
	contractsSvc.SetEventBus(eventBus)
	contractsmodule.RegisterRoutes(mux, contractsSvc, tokens, loader, deps.Queries, entitlementsSvc)
	var waClient messagingproviders.WhatsAppClient
	var messagingSvc *messagingusecase.Service
	onSession := func(orgID int64, jid, phone, displayName string, connected bool) {
		if messagingSvc == nil {
			return
		}
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if orgID == messagingmodel.PlatformOrgKey {
			if err := messagingSvc.UpdatePlatformSessionConnected(ctx, jid, phone, connected); err != nil {
				log.Warn("platform whatsapp session update failed", "err", err)
			}
			return
		}
		if err := messagingSvc.UpdateSessionConnected(ctx, orgID, jid, phone, displayName, connected); err != nil {
			log.Warn("whatsapp session update failed", "org_id", orgID, "err", err)
		}
	}
	onQR := func(orgID int64, code string, expiresAt time.Time) {
		if messagingSvc == nil {
			return
		}
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if orgID == messagingmodel.PlatformOrgKey {
			if err := messagingSvc.UpdatePlatformSessionQR(ctx, code, expiresAt); err != nil {
				log.Warn("platform whatsapp qr update failed", "err", err)
			}
			return
		}
		if err := messagingSvc.UpdateSessionQR(ctx, orgID, code, expiresAt); err != nil {
			log.Warn("whatsapp qr update failed", "org_id", orgID, "err", err)
		}
	}
	waMgr, waErr := messagingproviders.NewRealWhatsAppClientManager(cfg.DB.DSN(), log, onSession, onQR)
	if waErr != nil {
		log.Warn("whatsapp client manager unavailable, falling back to stub", "err", waErr)
		waClient = &messagingproviders.StubWhatsAppClient{Log: log}
	} else {
		waClient = waMgr.AsClient()
	}
	messagingSvc = messagingusecase.New(
		deps.Queries,
		messagingproviders.NewWhatsAppProvider(waClient, log),
		&messagingproviders.NoopSMSProvider{Log: log},
	)
	messagingSvc.SetStorage(deps.Storage)
	messagingSvc.SetEntitlements(entitlementsSvc)
	// Platform Cloud API number: credentials read per request from the panel.
	cloudClient := messagingcloud.New(platformWhatsAppSvc.CloudConfigReader(), nil)
	messagingSvc.SetCloudSender(cloudClient)
	// Platform-number messages name the platform (letterhead + public URL).
	messagingSvc.SetPlatformInfo(messagingusecase.AppSettingsPlatformInfo(deps.Queries, cfg.Auth.FrontendURL))
	if err := messagingcatalog.Seed(context.Background(), deps.Queries); err != nil {
		log.Warn("whatsapp template catalog seed failed", "err", err)
	}
	if deps.Queue != nil {
		messagingSvc.SetQueue(deps.Queue)
		// This process owns the WhatsApp sessions, so it consumes queued sends.
		s.msgWorker = queue.NewMessagingWorker(cfg, log, messagingSvc.ProcessOutbound)
	}
	messagingSvc.RestoreConnectedSessions(context.Background())
	messagingSvc.RestorePlatformSession(context.Background())
	messagingmodule.RegisterRoutes(mux, messagingSvc, tokens, loader, deps.Queries)
	dailySummarySvc := dsusecase.New(deps.Queries, dailysummary.NewMessagingSender(messagingSvc), log)
	dailysummary.RegisterRoutes(mux, dailySummarySvc, tokens, loader, deps.Queries)
	vehicleAlertsSvc := vausecase.New(deps.Queries, dailysummary.NewMessagingSender(messagingSvc), vehiclealerts.NewInAppNotifier(notifSvc), log)
	vehiclealerts.RegisterRoutes(mux, vehicleAlertsSvc, tokens, loader, deps.Queries)
	vehiclealerts.RegisterEventHandlers(eventBus, vehicleAlertsSvc, log)
	messagingResolver := messagingmodule.NewDBPhoneResolver(deps.Queries)
	messagingmodule.RegisterEventHandlers(eventBus, messagingSvc, messagingResolver, log)
	contractsSvc.SetOTPSender(messagingmodule.NewContractOTPSender(messagingSvc))
	purchasesSvc := purchasesusecase.New(deps.DB, deps.Queries, activityRec, financeSvc)
	purchasesSvc.SetSearchIndexer(searchIndexer)
	purchasesSvc.SetEventBus(eventBus)
	purchasesmodule.RegisterRoutes(mux, purchasesSvc, tokens, loader, deps.Queries)
	reportsSvc := reportsusecase.New(deps.Queries)
	reportsmodule.RegisterRoutes(mux, reportsSvc, tokens, loader, deps.Queries, entitlementsSvc)
	catalogSvc := catalogusecase.New(deps.DB, deps.Queries, activityRec)
	realtime.RegisterRoutes(mux, realtime.NewHandler(rtIssuer, uc), tokens, loader)

	qrGeo, err := qrlogin.NewLocator(cfg.Auth.QRGeoIPDB, cfg.Auth.QRTrustGeoHeaders)
	if err != nil {
		// Location is a hint only: keep QR sign-in up and show the IP.
		log.Warn("qrlogin_geoip_unavailable", "error", err)
	}
	var qrIssuer qrlogin.TokenIssuer
	if rtIssuer != nil {
		qrIssuer = rtIssuer
	}
	qrSvc := qrlogin.NewService(qrlogin.NewStore(deps.Redis, cfg.App.Env), uc, qrIssuer, deps.Realtime, cfg.Auth.FrontendURL, log)
	qrlogin.RegisterRoutes(mux, qrlogin.NewHandler(qrSvc, qrGeo, ratelimit.New(deps.Redis, cfg.App.Env)), tokens, loader)

	nh := notifhandler.New(notifSvc)
	nh.SetRateLimiter(ratelimit.New(deps.Redis, cfg.App.Env))
	notifmodule.RegisterRoutes(mux, nh, tokens, loader)
	notifmodule.RegisterEventHandlers(eventBus, notifSvc, log)

	ioReg := ioengine.NewRegistry(
		ioadapters.NewUsers(deps.Queries),
		ioadapters.NewRoles(deps.Queries),
		ioadapters.NewNotifications(deps.Queries),
		ioadapters.NewActivity(deps.Queries),
		ioadapters.NewFinanceAccounts(deps.Queries),
		ioadapters.NewFinanceCategories(deps.Queries),
		ioadapters.NewFinanceTransactions(deps.Queries),
		ioadapters.NewCatalogProducts(deps.Queries),
		ioadapters.NewCatalogServices(deps.Queries),
		ioadapters.NewCatalogCategories(deps.Queries),
		ioadapters.NewCariAccounts(deps.Queries),
		ioadapters.NewCariEntries(deps.Queries),
		ioadapters.NewJobs(deps.Queries),
		ioadapters.NewSales(deps.Queries),
		ioadapters.NewSuppliers(deps.Queries),
		ioadapters.NewPurchases(deps.Queries),
		ioadapters.NewReports(deps.Queries),
	)
	exportSvc := exportusecase.New(deps.Queries, deps.Storage, ioReg, deps.Queue, notifSvc, activityRec, log)
	exportSvc.SetDocumentPDF(pdfClient)
	importSvc := importusecase.New(deps.Queries, deps.Storage, ioReg, deps.Queue, notifSvc, activityRec, log)
	catalogProductsBulk := bulkadapters.NewCatalogProducts(deps.Queries)
	catalogServicesBulk := bulkadapters.NewCatalogServices(deps.Queries)
	if searchIndexer != nil {
		catalogProductsBulk.SetSearchIndexer(searchIndexer)
		catalogServicesBulk.SetSearchIndexer(searchIndexer)
	}
	bulkReg := bulkengine.NewRegistry(
		bulkadapters.NewUsers(deps.Queries),
		bulkadapters.NewRoles(deps.Queries),
		catalogProductsBulk,
		catalogServicesBulk,
	)
	bulkSvc := bulkusecase.New(deps.Queries, bulkReg, deps.Queue, notifSvc, activityRec, cfg.Bulk, log)
	catalogmodule.RegisterRoutes(mux, catalogSvc, bulkhandler.New(bulkSvc), tokens, loader, deps.Queries)
	vehicleSvc := vehicleusecase.New(deps.DB, deps.Queries, activityRec)
	vehicleSvc.SetSearchIndexer(searchIndexer)
	vehicleSvc.SetSearcher(searchClient)
	vehiclemodule.RegisterRoutes(mux, vehiclehandler.New(vehicleSvc, deps.Storage), tokens, loader, deps.Queries)
	customersSvc := customersusecase.New(deps.DB, deps.Queries, activityRec)
	customersSvc.SetEntitlements(entitlementsSvc)
	customersmodule.RegisterRoutes(mux, customersSvc, tokens, loader, deps.Queries)
	centerMessenger := messagingmodule.NewCenterMessenger(messagingSvc, deps.Queries)
	centerSvc := centerusecase.New(deps.Queries, notifSvc, centerMessenger, log).
		SetStorage(deps.Storage).
		SetAppURL(cfg.Auth.FrontendURL)
	notifycentermodule.RegisterRoutes(mux, centerSvc, tokens, loader, deps.Queries)
	// Plan-limit thresholds / renewal: owner e-mail + neutral in-app notice.
	billingSvc.SetOwnerAlerts(centerSvc, cfg.Auth.FrontendURL)
	entitlementsSvc.SetAlerter(billingSvc)
	// Leads & quotes ↔ notification center / todos integration.
	sales := salesflow.New(centerSvc, centerMessenger, deps.Queries, log)
	sales.Register(centerSvc)
	messagingSvc.SetOutboundObserver(func(ctx context.Context, o messagingusecase.OutboundOutcome) {
		if !o.Sent {
			sales.OutboundFailed(ctx, o.OrgID, o.EventType, o.SubjectUUID, o.Error)
		}
	})
	todosSvc := todosusecase.New(deps.Queries, activityRec)
	todosSvc.SetLogger(log)
	todosSvc.SetReminders(centerSvc)
	todosSvc.SetLinkResolver(salesflow.NewLinks(deps.Queries))
	centerSvc.RegisterGuard("todo", todosSvc.ReminderGuard)
	if deps.Queue == nil {
		s.reminderTick = centerSvc.ProcessDue
	}
	todosmodule.RegisterRoutes(mux, todosSvc, tokens, loader, deps.Queries)
	// Leads & quotes: lead todos are linked to the lead; quotes are sent and
	// reminded through the notification center (see internal/modules/salesflow).
	leadsSvc := leadsusecase.New(deps.DB, deps.Queries, activityRec)
	leadsSvc.SetTodoCreator(leadsusecase.TodosServiceCreator{Todos: todosSvc})
	leadsmodule.RegisterRoutes(mux, leadsSvc, tokens, loader, deps.Queries, entitlementsSvc)
	quotesSvc := quotesusecase.New(deps.DB, deps.Queries, activityRec, deps.Storage, pdfClient, cfg.Auth.FrontendURL)
	quotesSvc.SetLogger(log)
	quotesSvc.SetJobCreator(jobsSvc)
	quotesSvc.SetVehicleCreator(customersSvc)
	quotesSvc.SetMessenger(sales)
	quotesSvc.SetReminderScheduler(sales)
	quotesSvc.SetNotifier(sales)
	sales.SetQuotes(quotesSvc)
	quotesmodule.RegisterRoutes(mux, quotesSvc, ratelimit.New(deps.Redis, cfg.App.Env), tokens, loader, deps.Queries, entitlementsSvc)
	aiTools := aitools.DefaultRegistry(aitools.Deps{
		Customers:       customersSvc,
		CustomersSearch: deps.Queries,
		Cari:            cariSvc,
		Jobs:            jobsSvc,
		Reports:         reportsSvc,
		Finance:         financeSvc,
		Sales:           salesSvc,
		Catalog:         catalogSvc,
		CariWrite:       cariSvc,
		FinanceWrite:    financeSvc,
		CustomersWrite:  customersSvc,
		VehicleCatalog:  vehicleSvc,
		VehicleOptions:  deps.Queries,
		JobsWrite:       jobsSvc,
		CatalogLookup:   catalogSvc,
		SalesWrite:      salesSvc,
		Todos:           todosSvc,
	})
	aiSvc := aiusecase.New(deps.Queries, secretBox, aiTools, log)
	aiSvc.SetEntitlements(entitlementsSvc)
	aiSvc.SetActivityRecorder(activityRec)
	aiSvc.EnableActions()
	aiSvc.SetVoiceDefaultBaseURL(cfg.Speaches.BaseURL)
	aiSvc.SetVoiceAPIKey(cfg.Speaches.APIKey)
	aiSvc.SetVoiceAutoDownload(cfg.Speaches.AutoDownload)
	aiSvc.StartVoiceModelEnsure(context.Background())
	recoverCtx, cancelRecover := context.WithTimeout(context.Background(), 15*time.Second)
	if n := aiSvc.RecoverInterruptedActions(recoverCtx); n > 0 {
		log.Warn("ai_interrupted_actions_recovered", "count", n)
	}
	cancelRecover()
	aiHandler := aihandler.New(aiSvc, activityRec)
	aiHandler.SetRateLimiter(ratelimit.New(deps.Redis, cfg.App.Env))
	aimodule.RegisterRoutes(mux, aiHandler, tokens, loader, deps.Queries)
	logsSvc := logsusecase.New(deps.Queries)
	if s.worker != nil {
		s.worker.WithExport(exportSvc.ProcessExport).
			WithImport(importSvc.ProcessImport).
			WithBulk(bulkSvc.ProcessBulk).
			WithLogPurge(logsSvc.ApplyDueRules).
			WithContractExecute(contractsSvc.ExecutePDF).
			WithReminderSweep(centerSvc.ProcessDue).
			WithQuoteExpire(quotesSvc.ExpireDue).
			WithDailySummary(dailySummarySvc.SendDue).
			WithVehicleAlerts(vehicleAlertsSvc.Flush).
			WithBillingOrdersExpire(billingSvc.ExpireDueOrders).
			WithMobilePush(notifSvc.SendMobilePush, notifSvc.ProcessPushReceipts)
		if sched, err := queue.StartReminderScheduler(cfg, log); err != nil {
			log.Error("reminder_scheduler_init_failed", "error", err)
		} else {
			if err := queue.RegisterQuoteExpirySchedule(sched); err != nil {
				log.Error("quote_expiry_scheduler_failed", "error", err)
			}
			if err := queue.RegisterDailySummarySchedule(sched); err != nil {
				log.Error("daily_summary_scheduler_failed", "error", err)
			}
			if err := queue.RegisterVehicleAlertsSchedule(sched); err != nil {
				log.Error("vehicle_alerts_scheduler_failed", "error", err)
			}
			if err := queue.RegisterBillingOrdersExpireSchedule(sched); err != nil {
				log.Error("billing_orders_expire_scheduler_failed", "error", err)
			}
			if err := queue.RegisterPushReceiptsSchedule(sched); err != nil {
				log.Error("push_receipts_scheduler_failed", "error", err)
			}
			s.reminderSched = sched
		}
		if searchIndexer != nil {
			s.worker.WithSearch(
				searchIndexer.ProcessUpsert,
				searchIndexer.ProcessDelete,
				searchIndexer.ProcessReindex,
			)
		}
	}
	exportmodule.RegisterRoutes(mux, exporthandler.New(exportSvc), tokens, loader, stepUpSvc, deps.Queries, entitlementsSvc)
	importmodule.RegisterRoutes(mux, importhandler.New(importSvc), tokens, loader, deps.Queries)
	bulkmodule.RegisterRoutes(mux, bulkhandler.New(bulkSvc), tokens, loader)
	settingsmodule.RegisterRoutes(mux, settingshandler.New(settingsusecase.New(deps.Queries), deps.Storage), tokens, loader)
	accessmodule.RegisterRoutes(mux, accesshandler.New(stepUpSvc, activityRec), tokens, loader)
	authsettingsmodule.RegisterRoutes(mux, authsettingshandler.New(authSettingsSvc, activityRec), tokens, loader)
	githubmodule.RegisterRoutes(mux, githubhandler.New(githubSvc, activityRec), tokens, loader)
	platformwhatsappmodule.RegisterRoutes(mux, platformwhatsapphandler.New(platformWhatsAppSvc, activityRec).
		WithPlatform(platformwhatsappusecase.NewTemplates(deps.Queries, cloudClient), messagingSvc), tokens, loader)
	platformwhatsappmodule.RegisterWebhookRoutes(mux, platformwhatsapphandler.NewWebhookHandler(
		platformwhatsappusecase.NewWebhook(deps.Queries, secretBox, log), ratelimit.New(deps.Redis, cfg.App.Env), log))
	oauthprovidermodule.RegisterRoutes(mux, oauthproviderhandler.New(oauthProvSvc, activityRec), tokens, loader)
	activitymodule.RegisterRoutes(mux, activityhandler.New(activityusecase.New(deps.Queries)), tokens, loader)
	logsmodule.RegisterRoutes(mux, logshandler.New(logsSvc), tokens, loader)
	searchSvc := searchusecase.New(searchClient, searchReg, deps.Queries, log)
	searchmodule.RegisterRoutes(mux, searchhandler.New(searchSvc), tokens, loader)
	storageSvc := storageusecase.New(deps.Storage, deps.Queries, log)
	storageSvc.SetEntitlements(entitlementsSvc)
	storagemodule.RegisterRoutes(
		mux,
		storagehandler.New(storageSvc),
		tokens,
		loader,
	)

	outboxStore := outbox.NewStore(deps.DB, deps.Queries)
	outboxPub := outbox.NewPublisher(outboxStore, eventBus, log)
	s.outboxPub = outboxPub

	s.http = &http.Server{
		Addr:         cfg.HTTP.Addr,
		Handler:      middleware.RequestID(middleware.ServerErrors(log)(mux)),
		ReadTimeout:  cfg.HTTP.ReadTimeout,
		WriteTimeout: cfg.HTTP.WriteTimeout,
		IdleTimeout:  cfg.HTTP.IdleTimeout,
	}
	return s, nil
}

// Start listens until the server stops. Optionally starts an in-process queue worker.
func (s *Server) Start() error {
	if s.outboxPub != nil {
		s.outboxStop = s.outboxPub.StartRun(context.Background())
	}
	if s.worker != nil {
		go func() {
			if err := s.worker.Start(); err != nil {
				s.log.Error("queue_worker_failed", "error", err)
			}
		}()
	}
	if s.reminderSched != nil {
		if err := s.reminderSched.Start(); err != nil {
			s.log.Error("reminder_scheduler_failed", "error", err)
		}
	}
	if s.reminderTick != nil {
		ctx, cancel := context.WithCancel(context.Background())
		s.reminderStop = cancel
		go s.runReminderTicker(ctx)
	}
	if s.msgWorker != nil {
		if err := s.msgWorker.Start(); err != nil {
			s.log.Error("messaging_worker_failed", "error", err)
		}
	}
	if s.searchIndexer != nil {
		go s.searchIndexer.Bootstrap(context.Background())
	}
	s.log.Info("http_listen", "addr", s.cfg.HTTP.Addr, "env", s.cfg.App.Env)
	if err := s.http.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		return fmt.Errorf("httpserver: listen: %w", err)
	}
	return nil
}

// Shutdown gracefully stops the HTTP server, queue worker, and queue client.
func (s *Server) Shutdown(ctx context.Context) error {
	if s.outboxStop != nil {
		s.outboxStop()
	}
	if s.worker != nil {
		s.worker.Shutdown()
	}
	if s.reminderSched != nil {
		s.reminderSched.Shutdown()
	}
	if s.reminderStop != nil {
		s.reminderStop()
	}
	if s.msgWorker != nil {
		s.msgWorker.Shutdown()
	}
	if s.queueClient != nil {
		_ = s.queueClient.Close()
	}
	return s.http.Shutdown(ctx)
}

func (s *Server) handleAppConfig(w http.ResponseWriter, r *http.Request) {
	settingsSvc := settingsusecase.New(s.queries)
	letterhead, _ := settingsSvc.PublicLetterhead(r.Context())

	registrationEnabled := false
	passwordLogin := true
	passwordRegister := false
	passkeyLogin := true
	if s.authSettings != nil {
		if p, err := s.authSettings.Policy(r.Context()); err == nil {
			registrationEnabled = p.RegistrationEnabled
			passwordLogin = p.PasswordLoginEnabled
			passwordRegister = p.RegistrationEnabled && p.PasswordRegisterEnabled
			passkeyLogin = p.PasskeyLoginEnabled
		}
	}

	githubLogin, githubRegister := false, false
	if s.githubSvc != nil {
		githubLogin, _ = s.githubSvc.IsAuthEnabled(r.Context())
		reg, _ := s.githubSvc.IsRegisterEnabled(r.Context())
		githubRegister = registrationEnabled && reg
	}

	method := func(login, register bool) map[string]bool {
		return map[string]bool{"login": login, "register": register}
	}
	oauthMethod := func(provider string) map[string]bool {
		login, register := false, false
		if s.oauthProvSvc != nil {
			login, _ = s.oauthProvSvc.IsLoginEnabled(r.Context(), provider)
			reg, _ := s.oauthProvSvc.IsRegisterEnabled(r.Context(), provider)
			register = registrationEnabled && reg
		}
		return method(login, register)
	}

	responseJSON := map[string]any{
		"mode":                 "platform",
		"name":                 s.cfg.App.Name,
		"vapid_configured":     s.cfg.VAPID.PublicKey != "" && s.cfg.VAPID.PrivateKey != "",
		"github_auth_enabled":  githubLogin, // legacy
		"registration_enabled": registrationEnabled,
		"auth_methods": map[string]any{
			"password": method(passwordLogin, passwordRegister),
			"passkey":  map[string]bool{"login": passkeyLogin},
			"github":   method(githubLogin, githubRegister),
			"google":   oauthMethod("google"),
			"facebook": oauthMethod("facebook"),
			"apple":    oauthMethod("apple"),
		},
		"letterhead": letterhead,
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"success": true,
		"data":    responseJSON,
	})
}

func (s *Server) handleHealthz(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) handleReadyz(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()

	checks := map[string]string{
		"postgres": "ok",
		"redis":    "ok",
	}
	ready := true

	if err := database.Ping(ctx, s.db); err != nil {
		checks["postgres"] = "down"
		ready = false
	}
	if err := cache.Ping(ctx, s.redis); err != nil {
		checks["redis"] = "down"
		ready = false
	}

	if s.storage != nil {
		if err := s.storage.Ping(ctx); err != nil {
			s.log.Warn("readyz_storage_soft_check", "error", err)
		}
	}
	if s.searchClient != nil && s.searchClient.Enabled() {
		if err := s.searchClient.Ping(ctx); err != nil {
			checks["meilisearch"] = "down"
			s.log.Warn("readyz_meilisearch_soft_check", "error", err)
		} else {
			checks["meilisearch"] = "ok"
		}
	}

	status := http.StatusOK
	state := "ready"
	if !ready {
		status = http.StatusServiceUnavailable
		state = "not_ready"
	}

	writeJSON(w, status, map[string]any{
		"status": state,
		"checks": checks,
	})
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func storagePublicBaseURL(cfg config.StorageConfig) string {
	if strings.EqualFold(strings.TrimSpace(cfg.Driver), "s3") {
		return cfg.S3.PublicBaseURL
	}
	return cfg.MinIO.PublicBaseURL
}

// runReminderTicker dispatches due scheduled notifications every minute when
// no Asynq worker is available. The DB claim keeps it safe next to workers.
func (s *Server) runReminderTicker(ctx context.Context) {
	s.log.Info("reminder_ticker_started", "interval", "1m")
	t := time.NewTicker(time.Minute)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			runCtx, cancel := context.WithTimeout(ctx, 55*time.Second)
			if err := s.reminderTick(runCtx); err != nil {
				s.log.Error("reminder_ticker_failed", "error", err)
			}
			cancel()
		}
	}
}

type billingNotifier struct {
	pool          *pgxpool.Pool
	notifications *notifusecase.Service
	log           *slog.Logger
}

func (n *billingNotifier) NotifyOrganization(ctx context.Context, orgID int64, title, body, link string) {
	n.notifyOrganization(ctx, orgID, title, body, link, []string{notifmodel.ChannelInapp})
}

func (n *billingNotifier) NotifyOrganizationEmail(ctx context.Context, orgID int64, title, body, link string) {
	n.notifyOrganization(ctx, orgID, title, body, link, []string{notifmodel.ChannelInapp, notifmodel.ChannelEmail})
}

func (n *billingNotifier) notifyOrganization(ctx context.Context, orgID int64, title, body, link string, channels []string) {
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

func (n *billingNotifier) NotifyPlatform(ctx context.Context, title, body, link string) {
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

func (n *billingNotifier) enqueue(ctx context.Context, userID int64, title, body, link string, channels []string) {
	action := link
	if action == "" {
		action = "/platform/billing/payments"
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
