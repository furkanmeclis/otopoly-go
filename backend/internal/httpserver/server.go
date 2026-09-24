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
	jobsmodule "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/jobs"
	jobsusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/jobs/usecase"
	logsmodule "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/logs"
	logshandler "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/logs/handler"
	logsusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/logs/usecase"
	messagingmodule "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/messaging"
	messagingproviders "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/messaging/providers"
	messagingusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/messaging/usecase"
	notifmodule "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/notifications"
	notifhandler "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/notifications/handler"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/notifications/providers"
	notifusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/notifications/usecase"
	orgmodule "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/organizations"
	orgusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/organizations/usecase"
	purchasesmodule "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/purchases"
	purchasesusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/purchases/usecase"
	reportsmodule "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/reports"
	reportsusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/reports/usecase"
	salesmodule "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/sales"
	salesusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/sales/usecase"
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
	vehiclemodule "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/vehiclecatalog"
	vehiclehandler "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/vehiclecatalog/handler"
	vehicleusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/vehiclecatalog/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/activity"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/bulkengine"
	bulkadapters "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/bulkengine/adapters"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/crypto"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/events"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/ioengine"
	ioadapters "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/ioengine/adapters"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/jwt"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/mail"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/outbox"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/pdfrender"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/ratelimit"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/searchengine"
	searchadapters "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/searchengine/adapters"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/stepup"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/storage"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/queue"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/realtime"
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
	notifSvc := notifusecase.New(deps.Queries, deps.Queue, provs, log)
	notifSvc.WithActionSigner(cfg.JWT.AccessSecret, 0)
	notifSvc.WithVAPID(notifusecase.VAPIDConfig{
		PublicKey:  cfg.VAPID.PublicKey,
		PrivateKey: cfg.VAPID.PrivateKey,
		Subject:    cfg.VAPID.Subject,
	})

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
	oauthProvSvc := oauthproviderusecase.New(deps.Queries, secretBox)
	authSettingsSvc := authsettingsusecase.New(deps.Queries)
	uc.SetAuthSettings(authSettingsSvc)
	uc.SetAccessPolicy(stepUpSvc)
	uc.SetSecretBox(secretBox, cfg.App.Name)
	oauthUC := authusecase.NewOAuth(repo, secretBox)
	s.githubSvc = githubSvc
	s.oauthProvSvc = oauthProvSvc
	s.authSettings = authSettingsSvc

	h := authhandler.New(uc, oauthUC, githubSvc, oauthProvSvc, authSettingsSvc, cfg.Auth.AdapterSecret, stepUpSvc, activityRec)
	h.SetRateLimiter(ratelimit.New(deps.Redis, cfg.App.Env))
	loader := identity.Loader{UC: uc}
	orgSvc := orgusecase.New(deps.DB, deps.Queries)
	uc.SetOrganizationResolver(orgSvc)
	authmodule.RegisterRoutes(mux, h, tokens, loader, stepUpSvc)
	orgmodule.RegisterRoutes(mux, orgSvc, uc, deps.Storage, tokens, loader, deps.Queries)
	financeSvc := financeusecase.New(deps.DB, deps.Queries, activityRec)
	financeSvc.SetSearchIndexer(searchIndexer)
	financemodule.RegisterRoutes(mux, financeSvc, tokens, loader, deps.Queries)
	cariSvc := cariusecase.New(deps.DB, deps.Queries, activityRec, financeSvc)
	cariSvc.SetSearchIndexer(searchIndexer)
	cariSvc.SetEventBus(eventBus)
	carimodule.RegisterRoutes(mux, cariSvc, tokens, loader, deps.Queries)
	jobsSvc := jobsusecase.New(deps.DB, deps.Queries, activityRec, financeSvc, cariSvc)
	jobsSvc.SetSearchIndexer(searchIndexer)
	jobsSvc.SetEventBus(eventBus)
	jobsmodule.RegisterRoutes(mux, jobsSvc, tokens, loader, deps.Queries)
	staffSvc := staffusecase.New(deps.DB, deps.Queries, activityRec)
	staffmodule.RegisterRoutes(mux, staffSvc, tokens, loader, deps.Queries)
	salesSvc := salesusecase.New(deps.DB, deps.Queries, activityRec, financeSvc, cariSvc)
	salesSvc.SetSearchIndexer(searchIndexer)
	salesSvc.SetEventBus(eventBus)
	salesmodule.RegisterRoutes(mux, salesSvc, tokens, loader, deps.Queries)
	suppliersSvc := suppliersusecase.New(deps.DB, deps.Queries, activityRec)
	suppliersSvc.SetSearchIndexer(searchIndexer)
	suppliersSvc.SetEventBus(eventBus)
	suppliersmodule.RegisterRoutes(mux, suppliersSvc, tokens, loader, deps.Queries)
	pdfClient := pdfrender.New(cfg.Gotenberg.URL)
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
	contractsmodule.RegisterRoutes(mux, contractsSvc, tokens, loader, deps.Queries)
	var waClient messagingproviders.WhatsAppClient
	var messagingSvc *messagingusecase.Service
	onSession := func(orgID int64, jid, phone, displayName string, connected bool) {
		if messagingSvc == nil {
			return
		}
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
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
	messagingSvc.RestoreConnectedSessions(context.Background())
	messagingmodule.RegisterRoutes(mux, messagingSvc, tokens, loader, deps.Queries)
	messagingResolver := messagingmodule.NewDBPhoneResolver(deps.Queries)
	messagingmodule.RegisterEventHandlers(eventBus, messagingSvc, messagingResolver, log)
	contractsSvc.SetOTPSender(messagingmodule.NewContractOTPSender(messagingSvc))
	purchasesSvc := purchasesusecase.New(deps.DB, deps.Queries, activityRec, financeSvc)
	purchasesSvc.SetSearchIndexer(searchIndexer)
	purchasesSvc.SetEventBus(eventBus)
	purchasesmodule.RegisterRoutes(mux, purchasesSvc, tokens, loader, deps.Queries)
	reportsSvc := reportsusecase.New(deps.Queries)
	reportsmodule.RegisterRoutes(mux, reportsSvc, tokens, loader, deps.Queries)
	catalogSvc := catalogusecase.New(deps.DB, deps.Queries, activityRec)
	realtime.RegisterRoutes(mux, realtime.NewHandler(rtIssuer, uc), tokens, loader)

	nh := notifhandler.New(notifSvc)
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
	customersmodule.RegisterRoutes(mux, customersSvc, tokens, loader, deps.Queries)
	todosSvc := todosusecase.New(deps.Queries, activityRec)
	todosmodule.RegisterRoutes(mux, todosSvc, tokens, loader, deps.Queries)
	aiTools := aitools.DefaultRegistry(aitools.Deps{
		Customers:      deps.Queries,
		Cari:           cariSvc,
		Jobs:           jobsSvc,
		Reports:        reportsSvc,
		Finance:        financeSvc,
		Sales:          salesSvc,
		Catalog:        catalogSvc,
		CariWrite:      cariSvc,
		FinanceWrite:   financeSvc,
		CustomersWrite: customersSvc,
		VehicleCatalog: vehicleSvc,
		VehicleOptions: deps.Queries,
		JobsWrite:      jobsSvc,
		CatalogLookup:  catalogSvc,
		SalesWrite:     salesSvc,
		Todos:          todosSvc,
	})
	aiSvc := aiusecase.New(deps.Queries, secretBox, aiTools, log)
	aiSvc.SetActivityRecorder(activityRec)
	aiSvc.EnableActions()
	aiSvc.SetVoiceAPIKey(cfg.Speaches.APIKey)
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
			WithContractExecute(contractsSvc.ExecutePDF)
		if searchIndexer != nil {
			s.worker.WithSearch(
				searchIndexer.ProcessUpsert,
				searchIndexer.ProcessDelete,
				searchIndexer.ProcessReindex,
			)
		}
	}
	exportmodule.RegisterRoutes(mux, exporthandler.New(exportSvc), tokens, loader, stepUpSvc, deps.Queries)
	importmodule.RegisterRoutes(mux, importhandler.New(importSvc), tokens, loader, deps.Queries)
	bulkmodule.RegisterRoutes(mux, bulkhandler.New(bulkSvc), tokens, loader)
	settingsmodule.RegisterRoutes(mux, settingshandler.New(settingsusecase.New(deps.Queries), deps.Storage), tokens, loader)
	accessmodule.RegisterRoutes(mux, accesshandler.New(stepUpSvc, activityRec), tokens, loader)
	authsettingsmodule.RegisterRoutes(mux, authsettingshandler.New(authSettingsSvc, activityRec), tokens, loader)
	githubmodule.RegisterRoutes(mux, githubhandler.New(githubSvc, activityRec), tokens, loader)
	oauthprovidermodule.RegisterRoutes(mux, oauthproviderhandler.New(oauthProvSvc, activityRec), tokens, loader)
	activitymodule.RegisterRoutes(mux, activityhandler.New(activityusecase.New(deps.Queries)), tokens, loader)
	logsmodule.RegisterRoutes(mux, logshandler.New(logsSvc), tokens, loader)
	searchSvc := searchusecase.New(searchClient, searchReg, deps.Queries, log)
	searchmodule.RegisterRoutes(mux, searchhandler.New(searchSvc), tokens, loader)
	storagemodule.RegisterRoutes(
		mux,
		storagehandler.New(storageusecase.New(deps.Storage, deps.Queries, log)),
		tokens,
		loader,
	)

	outboxStore := outbox.NewStore(deps.DB, deps.Queries)
	outboxPub := outbox.NewPublisher(outboxStore, eventBus, log)
	s.outboxPub = outboxPub

	s.http = &http.Server{
		Addr:         cfg.HTTP.Addr,
		Handler:      middleware.ServerErrors(log)(middleware.RequestID(mux)),
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
