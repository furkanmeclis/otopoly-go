package tools

import (
	"context"
	"fmt"
	"math/big"
	"sort"
	"strings"

	catalogusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/catalog/usecase"
	financeusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/finance/usecase"
	jobsusecase "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/jobs/usecase"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/rbac"
	"github.com/google/uuid"
)

// ---------------------------------------------------------------- closest names

// closest returns up to n items ranked by how close their folded name is to
// the query (shared words first, then edit distance). Used to suggest catalog
// names instead of guessing.
func closest[T any](query string, items []T, name func(T) string, n int) []T {
	q := FoldTR(query)
	if q == "" || len(items) == 0 {
		return nil
	}
	qWords := strings.Fields(q)
	type scored struct {
		it    T
		score float64
	}
	all := make([]scored, 0, len(items))
	for _, it := range items {
		cand := FoldTR(name(it))
		shared := 0
		for _, w := range qWords {
			if strings.Contains(cand, w) {
				shared++
			}
		}
		dist := levenshtein(q, cand)
		longest := len([]rune(q))
		if l := len([]rune(cand)); l > longest {
			longest = l
		}
		sim := 1 - float64(dist)/float64(longest)
		all = append(all, scored{it: it, score: float64(shared)*2 + sim})
	}
	sort.SliceStable(all, func(i, j int) bool { return all[i].score > all[j].score })
	out := []T{}
	for i := 0; i < len(all) && i < n; i++ {
		if all[i].score < 0.35 {
			break
		}
		out = append(out, all[i].it)
	}
	return out
}

func levenshtein(a, b string) int {
	ra, rb := []rune(a), []rune(b)
	prev := make([]int, len(rb)+1)
	cur := make([]int, len(rb)+1)
	for j := range prev {
		prev[j] = j
	}
	for i := 1; i <= len(ra); i++ {
		cur[0] = i
		for j := 1; j <= len(rb); j++ {
			cost := 1
			if ra[i-1] == rb[j-1] {
				cost = 0
			}
			cur[j] = min(prev[j]+1, cur[j-1]+1, prev[j-1]+cost)
		}
		prev, cur = cur, prev
	}
	return prev[len(rb)]
}

// ---------------------------------------------------------------- services

func serviceLabel(s catalogusecase.ServiceItem) string {
	return fmt.Sprintf("%s (%s)", s.Name, FormatMoney(s.Price, s.Currency))
}

func activeServices(ctx context.Context, catalog CatalogLookup) ([]catalogusecase.ServiceItem, error) {
	active := true
	rows, _, err := catalog.ListServices(ctx, 100, 0, catalogusecase.ServiceFilters{IsActive: &active})
	return rows, err
}

// matchService resolves a catalog service by uuid or name. A name that is not
// in the catalog is an error with the closest catalog names: job lines are
// always catalog services, never free text.
func matchService(rows []catalogusecase.ServiceItem, ref string) (catalogusecase.ServiceItem, error) {
	ref = strings.TrimSpace(ref)
	if id, err := uuid.Parse(ref); err == nil {
		for _, s := range rows {
			if s.UUID == id {
				return s, nil
			}
		}
		return catalogusecase.ServiceItem{}, inputErr("service %s is not an active catalog service; use list_services", ref)
	}
	name := func(s catalogusecase.ServiceItem) string { return s.Name }
	s, matches, ok := matchByName(ref, rows, name)
	if ok {
		return s, nil
	}
	if len(matches) > 1 {
		return catalogusecase.ServiceItem{}, inputErr("service %q matches several catalog services: %s; pass the exact name or uuid", ref, names(matches, serviceLabel, 8))
	}
	if len(rows) == 0 {
		return catalogusecase.ServiceItem{}, inputErr("the service catalog is empty; add services in Katalog → Hizmetler first")
	}
	if near := closest(ref, rows, name, 5); len(near) > 0 {
		return catalogusecase.ServiceItem{}, inputErr("service %q is not in the catalog (job lines must be catalog services). Closest: %s. Use list_services for the full list", ref, names(near, serviceLabel, 5))
	}
	return catalogusecase.ServiceItem{}, inputErr("service %q is not in the catalog (job lines must be catalog services). Available: %s", ref, names(rows, serviceLabel, 15))
}

// jobLine is one resolved service line of a job proposal.
type jobLine struct {
	Service    catalogusecase.ServiceItem
	Price      *big.Rat
	Qty        *big.Rat
	Total      *big.Rat
	Overridden bool
}

// resolveJobLines resolves service lines against the active catalog and
// returns the normalized input (service uuids), the lines and the total.
func resolveJobLines(ctx context.Context, catalog CatalogLookup, in []jobServiceInput) ([]jobServiceInput, []jobLine, *big.Rat, string, error) {
	rows, err := activeServices(ctx, catalog)
	if err != nil {
		return nil, nil, nil, "", err
	}
	total := new(big.Rat)
	cur := "TRY"
	norm := make([]jobServiceInput, 0, len(in))
	lines := make([]jobLine, 0, len(in))
	for _, l := range in {
		svc, err := matchService(rows, l.Service)
		if err != nil {
			return nil, nil, nil, "", err
		}
		cur = firstNonBlank(svc.Currency, cur)
		catalogPrice := ratOf(svc.Price)
		price := catalogPrice
		overridden := false
		if l.Price != nil {
			price = new(big.Rat).SetFloat64(*l.Price)
			overridden = price.Cmp(catalogPrice) != 0
		}
		qty := big.NewRat(1, 1)
		if l.Qty != nil {
			qty = new(big.Rat).SetFloat64(*l.Qty)
		}
		lt := new(big.Rat).Mul(price, qty)
		total.Add(total, lt)
		lines = append(lines, jobLine{Service: svc, Price: price, Qty: qty, Total: lt, Overridden: overridden})
		norm = append(norm, jobServiceInput{Service: svc.UUID.String(), Price: l.Price, Qty: l.Qty})
	}
	return norm, lines, total, cur, nil
}

func jobLinesText(lines []jobLine, cur string) string {
	parts := make([]string, 0, len(lines))
	for _, l := range lines {
		label := l.Service.Name
		if l.Qty.Cmp(big.NewRat(1, 1)) != 0 {
			label += " ×" + fmtQty(l.Qty)
		}
		label += " " + FormatMoney(l.Total.FloatString(2), cur)
		if l.Overridden {
			label += " (katalog " + FormatMoney(l.Service.Price, cur) + ")"
		}
		parts = append(parts, label)
	}
	return strings.Join(parts, " · ")
}

// jobLinesResult describes the created job's lines with the catalog service
// each one matched and whether its price differs from the catalog.
func jobLinesResult(detail jobsusecase.JobDetail, catalog map[uuid.UUID]catalogusecase.ServiceItem) []map[string]any {
	out := make([]map[string]any, 0, len(detail.Lines))
	for _, l := range detail.Lines {
		row := map[string]any{
			"name": DataText(l.Name, maxNameChars), "unit_price": FormatMoney(l.UnitPrice, l.Currency),
			"qty": l.Qty, "line_total": FormatMoney(l.LineTotal, l.Currency),
		}
		if l.ServiceUUID != nil {
			if svc, ok := catalog[*l.ServiceUUID]; ok {
				row["matched_service"] = map[string]any{
					"uuid": svc.UUID.String(), "name": DataText(svc.Name, maxNameChars), "catalog_price": FormatMoney(svc.Price, svc.Currency),
				}
				row["price_overridden"] = ratOf(l.UnitPrice).Cmp(ratOf(svc.Price)) != 0
			}
		}
		out = append(out, row)
	}
	return out
}

func catalogByUUID(rows []catalogusecase.ServiceItem) map[uuid.UUID]catalogusecase.ServiceItem {
	m := make(map[uuid.UUID]catalogusecase.ServiceItem, len(rows))
	for _, s := range rows {
		m[s.UUID] = s
	}
	return m
}

// ---------------------------------------------------------------- finding jobs

func jobLabel(j jobsusecase.Job, env Env) string {
	return fmt.Sprintf("%s %s %s/%s %s (%s)", j.UUID, j.Plate, j.Status, j.PaymentStatus,
		FormatMoney(j.TotalAmount, j.Currency), fmtTime(j.StartedAt, env.Location))
}

// findJob resolves a job by uuid or plate. By plate it keeps the jobs accept
// allows and asks for the uuid when several match; by uuid it returns the job
// whatever its state (callers explain why a state does not fit).
func findJob(ctx context.Context, env Env, jobs JobsWriter, jobUUID, plate string, accept func(jobsusecase.Job) bool, what string) (jobsusecase.JobDetail, error) {
	if id, err := uuid.Parse(strings.TrimSpace(jobUUID)); err == nil {
		d, err := jobs.Get(ctx, id)
		if err != nil {
			return jobsusecase.JobDetail{}, proposalError(err)
		}
		return d, nil
	}
	key := PlateKey(plate)
	if key == "" {
		return jobsusecase.JobDetail{}, inputErr("pass job_uuid or plate")
	}
	rows, _, err := jobs.List(ctx, 25, 0, jobsusecase.ListFilters{Q: key, Sort: "-started_at"})
	if err != nil {
		return jobsusecase.JobDetail{}, err
	}
	var hits []jobsusecase.Job
	for _, j := range rows {
		if PlateKey(j.Plate) == key && accept(j) {
			hits = append(hits, j)
		}
	}
	switch len(hits) {
	case 0:
		return jobsusecase.JobDetail{}, inputErr("no %s job found for plate %s; use list_jobs", what, displayPlate(plate))
	case 1:
		d, err := jobs.Get(ctx, hits[0].UUID)
		if err != nil {
			return jobsusecase.JobDetail{}, proposalError(err)
		}
		return d, nil
	}
	return jobsusecase.JobDetail{}, inputErr("several %s jobs for plate %s; pass job_uuid (one of: %s)", what, displayPlate(plate),
		names(hits, func(j jobsusecase.Job) string { return jobLabel(j, env) }, 6))
}

func unpaidOpen(j jobsusecase.Job) bool {
	return j.PaymentStatus == "unpaid" && (j.Status == "in_progress" || j.Status == "ready" || j.Status == "delivered")
}

// ---------------------------------------------------------------- job payment

// jobPaymentValues are the ways a job can be paid. transfer (havale/EFT) is
// booked like card: into a bank account (the jobs module knows cash, card
// and cari).
var jobPaymentValues = []string{"cash", "card", "transfer", "cari"}

func closeMethod(m string) string {
	if m == "transfer" {
		return "card"
	}
	return m
}

// jobPayment resolves where a job payment goes and reads balances after it.
type jobPayment struct {
	finance FinanceReader
	cari    CariReader
}

type payPlan struct {
	Method   string
	Account  financeusecase.Account
	Accounts []financeusecase.Account
	Fields   []Field
	Warnings []string
	Edit     []EditField
}

func (p jobPayment) canSeeCari(env Env) bool {
	return p.cari != nil && env.Principal.HasPermission(rbac.PermTenantCariRead)
}

// plan validates a payment of amount for a job of customerUUID in currency.
func (p jobPayment) plan(ctx context.Context, env Env, customerUUID uuid.UUID, amount, currency, method, accountRef string) (payPlan, error) {
	out := payPlan{Method: method}
	if ratOf(amount).Sign() <= 0 {
		return out, inputErr("the job total is zero; a payment needs a positive total")
	}
	out.Fields = append(out.Fields, Field{Key: "payment_method", ValueKey: "ai.confirm.values." + method})
	out.Edit = append(out.Edit, EditField{Key: "payment_method", Type: "select", Value: method, Options: methodOptions(jobPaymentValues), Required: true})
	if method == "cari" {
		if p.canSeeCari(env) && customerUUID != uuid.Nil {
			if acc, err := p.cari.GetByCustomer(ctx, customerUUID); err == nil {
				after := balanceAfter(acc.Balance, ratOf(amount))
				out.Fields = append(out.Fields,
					Field{Key: "balance_before", Value: FormatMoney(acc.Balance, acc.Currency)},
					Field{Key: "balance_after", Value: FormatMoney(after, acc.Currency)})
			}
		}
		return out, nil
	}
	if p.finance == nil || !env.Principal.HasPermission(rbac.PermTenantFinanceRead) {
		return out, inputErr("taking a cash/card payment needs the finance read permission; use payment_method cari or ask the owner")
	}
	accounts, err := activeAccounts(ctx, p.finance)
	if err != nil {
		return out, err
	}
	fa, err := resolveAccount(accounts, accountRef, currency, preferredAccountType(method), "finance_account")
	if err != nil {
		return out, err
	}
	out.Account, out.Accounts = fa, accounts
	out.Fields = append(out.Fields,
		Field{Key: "finance_account", Value: fa.Name},
		Field{Key: "account_balance_after", Value: FormatMoney(balanceAfter(fa.CurrentBalance, ratOf(amount)), fa.Currency)})
	out.Edit = append(out.Edit, EditField{Key: "finance_account", Type: "select", Value: fa.UUID.String(), Options: accountOptions(accounts, currency), Required: true})
	return out, nil
}

// close takes the payment through the jobs module (job → paid, finance
// "Hizmet Geliri" income or a cari charge, in one database transaction).
func closeJob(ctx context.Context, jobs JobsWriter, id uuid.UUID, method, account string) (jobsusecase.JobDetail, error) {
	in := jobsusecase.CloseInput{Method: closeMethod(method)}
	if method != "cari" {
		fid, err := uuid.Parse(account)
		if err != nil {
			return jobsusecase.JobDetail{}, inputErr("finance_account is required for %s", method)
		}
		in.FinanceAccountUUID = &fid
	}
	return jobs.Close(ctx, id, in)
}

// paymentResult is the result part of a taken payment: the posted payment,
// the finance / cari record it created and the balances after it.
func (p jobPayment) paymentResult(ctx context.Context, env Env, job jobsusecase.JobDetail, method string) map[string]any {
	out := map[string]any{"method": method, "recorded_as": closeMethod(method)}
	for i := len(job.Payments) - 1; i >= 0; i-- {
		pay := job.Payments[i]
		if pay.Status != "posted" {
			continue
		}
		out["amount"] = FormatMoney(pay.Amount, pay.Currency)
		out["payment_uuid"] = pay.UUID.String()
		if pay.FinanceTransactionUUID != nil {
			out["finance_transaction_uuid"] = pay.FinanceTransactionUUID.String()
			out["finance_category"] = financeusecase.CategoryServiceIncome
		}
		if pay.FinanceAccountName != nil {
			out["finance_account"] = DataText(*pay.FinanceAccountName, maxNameChars)
		}
		if pay.CariEntryUUID != nil {
			out["cari_entry_uuid"] = pay.CariEntryUUID.String()
		}
		if pay.FinanceAccountUUID != nil {
			for k, v := range p.accountBalance(ctx, env, *pay.FinanceAccountUUID) {
				out[k] = v
			}
		}
		break
	}
	if method == "cari" {
		for k, v := range p.cariBalance(ctx, env, job.CustomerUUID) {
			out[k] = v
		}
	}
	return out
}

func (p jobPayment) accountBalance(ctx context.Context, env Env, id uuid.UUID) map[string]any {
	if p.finance == nil || !env.Principal.HasPermission(rbac.PermTenantFinanceRead) {
		return nil
	}
	accs, err := activeAccounts(ctx, p.finance)
	if err != nil {
		return nil
	}
	for _, a := range accs {
		if a.UUID == id {
			return map[string]any{"account_balance": FormatMoney(a.CurrentBalance, a.Currency), "account_balance_number": Number(a.CurrentBalance)}
		}
	}
	return nil
}

func (p jobPayment) cariBalance(ctx context.Context, env Env, customerUUID uuid.UUID) map[string]any {
	if !p.canSeeCari(env) {
		return nil
	}
	acc, err := p.cari.GetByCustomer(ctx, customerUUID)
	if err != nil {
		return nil
	}
	return map[string]any{"cari_balance": FormatMoney(acc.Balance, acc.Currency), "cari_balance_number": Number(acc.Balance)}
}
