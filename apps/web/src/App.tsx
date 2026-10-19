import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type FormEvent } from 'react';

type InvoiceItem = {
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
};

type ParsedInvoice = {
  invoiceNumber: string;
  supplier: string;
  issueDate: string;
  dueDate?: string;
  currency: string;
  subtotal: number;
  tax: number;
  total: number;
  lineItems: InvoiceItem[];
};

type SavedInvoice = ParsedInvoice & {
  id: string;
  status: 'needs_review' | 'approved' | 'rejected';
  confidence: number;
  createdAt: string;
};

type UploadedDocument = {
  id: string;
  originalName: string;
  contentType: string;
  sizeBytes: number;
  status: string;
  downloadUrl: string;
};

type ExtractedField<T> = {
  value: T | null;
  confidence: number;
  evidence: string | null;
  pageNumber: number | null;
};

type InvoiceExtractionCandidate = {
  schemaVersion: number;
  documentType: 'invoice' | 'unknown';
  reviewRequired: true;
  fields: {
    invoiceNumber: ExtractedField<string>;
    supplier: ExtractedField<string>;
    issueDate: ExtractedField<string>;
    dueDate: ExtractedField<string>;
    currency: ExtractedField<string>;
    subtotal: ExtractedField<number>;
    tax: ExtractedField<number>;
    total: ExtractedField<number>;
  };
  notes: string[];
};

type DocumentExtraction = {
  provider: string;
  engineVersion: string;
  text: string;
  pages: Array<{ pageNumber: number; text: string }>;
  structuredData: InvoiceExtractionCandidate | null;
};

type Account = {
  id: number;
  email: string;
  fullName: string;
  tenantId: number;
  role: 'admin' | 'reviewer' | 'viewer';
};

type ReviewEvent = {
  action: string;
  fromStatus: string | null;
  toStatus: string | null;
  reason: string | null;
  changes: { fields?: string[] };
  createdAt: string;
  userName: string;
};

const emptyInvoice: ParsedInvoice = {
  invoiceNumber: '',
  supplier: '',
  issueDate: '',
  dueDate: '',
  currency: 'USD',
  subtotal: 0,
  tax: 0,
  total: 0,
  lineItems: [{ description: '', quantity: 1, unitPrice: 0, amount: 0 }],
};

const apiUrl = (path: string) => `${import.meta.env.VITE_API_URL ?? ''}${path}`;
const money = (value: number, currency: string) => `${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;

function mapInvoice(row: Record<string, unknown>): SavedInvoice {
  return {
    id: String(row.id),
    invoiceNumber: String(row.invoiceNumber),
    supplier: String(row.supplier),
    issueDate: String(row.issueDate),
    dueDate: row.dueDate ? String(row.dueDate) : '',
    currency: String(row.currency),
    subtotal: Number(row.subtotal),
    tax: Number(row.tax),
    total: Number(row.total),
    confidence: Number(row.confidence),
    status: row.status as SavedInvoice['status'],
    createdAt: String(row.createdAt),
    lineItems: (row.lineItems as Array<Record<string, unknown>>).map((item) => ({
      description: String(item.description),
      quantity: Number(item.quantity),
      unitPrice: Number(item.unitPrice),
      amount: Number(item.amount),
    })),
  };
}

export default function App() {
  const [invoice, setInvoice] = useState<ParsedInvoice>(emptyInvoice);
  const [queue, setQueue] = useState<SavedInvoice[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [status, setStatus] = useState<'verified' | 'needs_review'>('needs_review');
  const [confidence, setConfidence] = useState<number>(0);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [apiError, setApiError] = useState('');
  const [document, setDocument] = useState<UploadedDocument | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [ocrRunning, setOcrRunning] = useState(false);
  const [ocrError, setOcrError] = useState('');
  const [ocrResult, setOcrResult] = useState<DocumentExtraction | null>(null);
  const [account, setAccount] = useState<Account | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState('');
  const [authForm, setAuthForm] = useState({ email: '', password: '', fullName: '', organizationName: '' });
  const [reviewReason, setReviewReason] = useState('');
  const [reviewHistory, setReviewHistory] = useState<ReviewEvent[]>([]);
  const [historyError, setHistoryError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  const refreshInvoices = useCallback(async () => {
    const response = await fetch(apiUrl('/api/invoices'), { credentials: 'include' });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.message ?? `Could not load invoices (HTTP ${response.status}).`);
    const invoices = (payload.data as Array<Record<string, unknown>>).map(mapInvoice);
    setQueue(invoices);
    if (selectedId) {
      const selected = invoices.find((item) => item.id === selectedId);
      if (selected) setStatus(selected.status === 'approved' ? 'verified' : 'needs_review');
    }
    return invoices;
  }, [selectedId]);

  useEffect(() => {
    const loadSession = async () => {
      try {
        const response = await fetch(apiUrl('/api/auth/me'), { credentials: 'include' });
        if (response.ok) {
          const payload = await response.json();
          setAccount(payload.data as Account);
          const invoiceResponse = await fetch(apiUrl('/api/invoices'), { credentials: 'include' });
          const invoicePayload = await invoiceResponse.json();
          if (!invoiceResponse.ok) throw new Error(invoicePayload.message ?? 'Could not load invoices.');
          setQueue((invoicePayload.data as Array<Record<string, unknown>>).map(mapInvoice));
        } else if (response.status !== 401) {
          throw new Error(`Could not check sign-in status (HTTP ${response.status}).`);
        }
      } catch (error) {
        setApiError(error instanceof Error ? error.message : 'Could not connect to the FinSight API.');
      } finally {
        setAuthReady(true);
      }
    };
    void loadSession();
  }, []);

  const totalFromItems = useMemo(
    () => invoice.lineItems.reduce((sum, item) => sum + item.amount, 0),
    [invoice.lineItems],
  );
  const selectedStatus = queue.find((item) => item.id === selectedId)?.status;

  const handleAuth = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAuthBusy(true);
    setAuthError('');
    try {
      const endpoint = authMode === 'register' ? '/api/auth/register' : '/api/auth/login';
      const response = await fetch(apiUrl(endpoint), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(authForm),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? 'Sign in failed.');
      setAccount(payload.data as Account);
      setApiError('');
      if (authMode === 'register') {
        setQueue([]);
      } else {
        await refreshInvoices();
      }
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'Could not sign in.');
    } finally {
      setAuthBusy(false);
    }
  };

  const logout = async () => {
    try {
      const response = await fetch(apiUrl('/api/auth/logout'), { method: 'POST', credentials: 'include' });
      if (!response.ok) throw new Error(`Sign out failed (HTTP ${response.status}).`);
    } catch (error) {
      setApiError(error instanceof Error ? error.message : 'Could not sign out.');
    } finally {
      setAccount(null);
      setQueue([]);
      setSelectedId('');
      setReviewHistory([]);
    }
  };

  const handleSubmit = async () => {
    setLoading(true);
    setApiError('');
    try {
      const endpoint = selectedId ? `/api/invoices/${selectedId}` : '/api/invoices';
      const response = await fetch(apiUrl(endpoint), {
        method: selectedId ? 'PUT' : 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(invoice),
      });
      const payload = await response.json();
      if (!response.ok) {
        setWarnings(payload.errors ? ['Review the invoice fields and correct validation errors.'] : [payload.message]);
        setStatus('needs_review');
        return;
      }
      const saved = mapInvoice(payload.data);
      setQueue((previous) => [saved, ...previous.filter((item) => item.id !== saved.id)]);
      setInvoice(saved);
      setSelectedId(saved.id);
      setStatus('needs_review');
      setConfidence(Number(payload.data.confidence));
      setWarnings(payload.warnings ?? []);
      setReviewHistory([]);
    } catch (error) {
      setApiError(error instanceof Error ? error.message : 'Could not save this invoice.');
    } finally {
      setLoading(false);
    }
  };

  const uploadDocument = async (file: File) => {
    setUploading(true);
    setUploadError('');
    setDocument(null);
    setOcrError('');
    setOcrResult(null);
    try {
      const body = new FormData();
      body.append('file', file);
      const response = await fetch(apiUrl('/api/documents'), {
        method: 'POST',
        credentials: 'include',
        body,
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? 'Upload failed.');
      setDocument(payload.data as UploadedDocument);
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : 'Could not upload this document.');
    } finally {
      setUploading(false);
    }
  };

  const runDocumentOcr = async () => {
    if (!document) return;
    setOcrRunning(true);
    setOcrError('');
    try {
      const response = await fetch(apiUrl(`/api/documents/${document.id}/ocr`), {
        method: 'POST',
        credentials: 'include',
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? 'Could not process this document.');
      setOcrResult(payload.data as DocumentExtraction);
    } catch (error) {
      setOcrError(error instanceof Error ? error.message : 'Could not process this document.');
    } finally {
      setOcrRunning(false);
    }
  };

  const applyExtractedFields = () => {
    const candidate = ocrResult?.structuredData;
    if (!candidate || candidate.documentType !== 'invoice') return;
    const fields = candidate.fields;
    setInvoice({
      invoiceNumber: fields.invoiceNumber.value ?? '',
      supplier: fields.supplier.value ?? '',
      issueDate: fields.issueDate.value ?? '',
      dueDate: fields.dueDate.value ?? '',
      currency: fields.currency.value ?? 'USD',
      subtotal: fields.subtotal.value ?? 0,
      tax: fields.tax.value ?? 0,
      total: fields.total.value ?? 0,
      lineItems: [{ description: '', quantity: 1, unitPrice: 0, amount: 0 }],
    });
    setSelectedId('');
    setStatus('needs_review');
    setConfidence(0);
    setWarnings([]);
    setReviewHistory([]);
  };

  const handleUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) await uploadDocument(file);
    event.target.value = '';
  };

  const handleDrop = async (event: DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    if (file) await uploadDocument(file);
  };

  const preventDragNavigation = (event: DragEvent<HTMLButtonElement>) => event.preventDefault();

  const updateLineItem = (index: number, field: keyof InvoiceItem, value: string | number) => {
    const nextItems = invoice.lineItems.map((item, itemIndex) => {
      if (itemIndex !== index) return item;
      const safeValue = field === 'description' ? String(value) : Number(value);
      return { ...item, [field]: safeValue };
    });
    setInvoice({ ...invoice, lineItems: nextItems });
  };

  const addLineItem = () => setInvoice({
    ...invoice,
    lineItems: [...invoice.lineItems, { description: '', quantity: 1, unitPrice: 0, amount: 0 }],
  });

  const startNewInvoice = () => {
    setInvoice({
      ...emptyInvoice,
      lineItems: [{ description: '', quantity: 1, unitPrice: 0, amount: 0 }],
    });
    setSelectedId('');
    setStatus('needs_review');
    setConfidence(0);
    setWarnings([]);
    setReviewHistory([]);
  };

  const selectInvoice = async (selected: SavedInvoice) => {
    setInvoice(selected);
    setSelectedId(selected.id);
    setStatus(selected.status === 'approved' ? 'verified' : 'needs_review');
    setWarnings([]);
    setConfidence(selected.confidence);
    setHistoryError('');
    try {
      const response = await fetch(apiUrl(`/api/invoices/${selected.id}/history`), { credentials: 'include' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? 'Could not load review history.');
      setReviewHistory(payload.data as ReviewEvent[]);
    } catch (error) {
      setReviewHistory([]);
      setHistoryError(error instanceof Error ? error.message : 'Could not load review history.');
    }
  };

  const transitionInvoice = async (nextStatus: 'approved' | 'rejected' | 'needs_review') => {
    if (!selectedId) return;
    setLoading(true);
    setApiError('');
    try {
      const response = await fetch(apiUrl(`/api/invoices/${selectedId}/status`), {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus, reason: reviewReason }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? 'Could not update invoice status.');
      const updated = mapInvoice(payload.data);
      setQueue((previous) => previous.map((item) => item.id === updated.id ? updated : item));
      setInvoice(updated);
      setStatus(updated.status === 'approved' ? 'verified' : 'needs_review');
      setReviewReason('');
      await selectInvoice(updated);
    } catch (error) {
      setApiError(error instanceof Error ? error.message : 'Could not update invoice status.');
    } finally {
      setLoading(false);
    }
  };

  if (!authReady) {
    return <main className="auth-screen"><p>Connecting securely to FinSight…</p></main>;
  }

  if (!account) {
    return (
      <main className="auth-screen">
        <form className="auth-card" onSubmit={handleAuth}>
          <a className="brand auth-brand" href="/" aria-label="FinSight home">
            <span className="brand-mark">F</span><span>FinSight</span>
          </a>
          <p className="section-kicker">PRIVATE FINANCE WORKSPACE</p>
          <h1>{authMode === 'register' ? 'Create your workspace' : 'Welcome back'}</h1>
          <p className="auth-copy">Sign in to access your organization’s invoices and documents.</p>
          {authMode === 'register' && (
            <>
              <label>Your name<input required maxLength={120} autoComplete="name" value={authForm.fullName} onChange={(event) => setAuthForm({ ...authForm, fullName: event.target.value })} /></label>
              <label>Organization<input required minLength={2} maxLength={120} autoComplete="organization" value={authForm.organizationName} onChange={(event) => setAuthForm({ ...authForm, organizationName: event.target.value })} /></label>
            </>
          )}
          <label>Email<input required type="email" maxLength={254} autoComplete="email" value={authForm.email} onChange={(event) => setAuthForm({ ...authForm, email: event.target.value })} /></label>
          <label>Password<input required type="password" minLength={authMode === 'register' ? 12 : 1} maxLength={128} autoComplete={authMode === 'register' ? 'new-password' : 'current-password'} value={authForm.password} onChange={(event) => setAuthForm({ ...authForm, password: event.target.value })} /></label>
          {authError && <div className="alert error-alert" role="alert">{authError}</div>}
          {apiError && <div className="alert error-alert" role="alert">{apiError}</div>}
          <button className="primary-btn auth-submit" type="submit" disabled={authBusy}>{authBusy ? 'Please wait…' : authMode === 'register' ? 'Create workspace' : 'Sign in'}</button>
          <p className="auth-switch">
            {authMode === 'register' ? 'Already have an account?' : 'New to FinSight?'}{' '}
            <button type="button" className="text-btn" onClick={() => { setAuthError(''); setAuthMode(authMode === 'register' ? 'login' : 'register'); }}>
              {authMode === 'register' ? 'Sign in' : 'Create a workspace'}
            </button>
          </p>
          {authMode === 'register' && <p className="auth-footnote">Passwords must contain at least 12 characters. Your workspace is private to your organization.</p>}
        </form>
      </main>
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="FinSight home"><span className="brand-mark">F</span><span>FinSight</span></a>
        <p className="nav-label">WORKSPACE</p>
        <a className="nav-link active" href="#overview" title="Overview"><span>◫</span> Overview</a>
        <a className="nav-link" href="#review-queue" title="Invoices"><span>▤</span> Invoices <span className="nav-count">{queue.length}</span></a>
        <a className="nav-link" href="#upload" title="Upload documents"><span>⇧</span> Upload documents</a>
        <div className="sidebar-bottom">
          <div className="secure-note"><span className="secure-dot" /> Private workspace</div>
          <div className="user-chip"><span className="avatar">{account.fullName.slice(0, 2).toUpperCase()}</span><span><strong>{account.fullName}</strong><small>{account.role}</small></span></div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="breadcrumbs">Workspace <span>/</span> <strong>Overview</strong></div>
          <div className="topbar-actions"><span className="today-label">Finance operations</span><button className="text-btn" onClick={() => void logout()}>Sign out</button></div>
        </header>

        <div className="content">
          <section className="page-heading" id="overview">
            <div><p className="eyebrow">PRIVATE WORKSPACE</p><h1>Good morning, {account.fullName.split(' ')[0]} <span className="wave">✦</span></h1><p className="subtitle">Review your organization’s invoice operations.</p></div>
            <button className="primary-btn" onClick={() => fileInput.current?.click()}>＋ Upload invoice</button>
          </section>
          {apiError && <div className="alert error-alert" role="alert">{apiError}</div>}

          <section className="stats-grid" aria-label="Invoice metrics">
            <article className="stat-card"><div className="stat-top"><span className="stat-icon indigo">▤</span><span className="stat-trend neutral">Live</span></div><span className="stat-label">Saved invoices</span><strong className="stat-value">{queue.length.toString().padStart(2, '0')}</strong><span className="stat-foot">Organization records</span></article>
            <article className="stat-card"><div className="stat-top"><span className="stat-icon amber">≡</span><span className="stat-trend neutral">Selected invoice</span></div><span className="stat-label">Line items</span><strong className="stat-value">{invoice.lineItems.length.toString().padStart(2, '0')}</strong><span className="stat-foot">In the current review form</span></article>
            <article className="stat-card"><div className="stat-top"><span className="stat-icon green">✓</span><span className={`stat-trend ${status === 'verified' ? '' : 'neutral'}`}>Rule checks</span></div><span className="stat-label">Current workflow</span><strong className="stat-value">{status === 'verified' ? 'Approved' : 'Review'}</strong><span className="stat-foot">Validation is not approval</span></article>
            <article className="stat-card total-card"><div className="stat-top"><span className="stat-icon pale">＄</span><span className="stat-trend neutral">Selected</span></div><span className="stat-label">Current invoice total</span><strong className="stat-value">{invoice.total.toLocaleString()} <small>{invoice.currency}</small></strong><span className="stat-foot">Stored invoice value</span></article>
          </section>

          <section className="workspace-grid">
            <div className="main-column">
              <section className="panel upload-panel" id="upload">
                <div className="section-title"><div><span className="section-kicker">DOCUMENT INTAKE</span><h2>Bring your invoices together</h2></div><span className="file-limit">PDF · PNG · JPG · WEBP</span></div>
                <button className="dropzone" type="button" onClick={() => fileInput.current?.click()} onDragOver={preventDragNavigation} onDrop={handleDrop} disabled={uploading}>
                  <span className="upload-icon">⇧</span><strong>{uploading ? 'Uploading…' : 'Drop a file here, or browse'}</strong><span>Maximum file size 12 MB. Local English and Arabic OCR is available for review.</span>
                </button>
                <input ref={fileInput} className="visually-hidden" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp" onChange={handleUpload} />
                {uploadError && <div className="alert error-alert" role="alert">{uploadError}</div>}
                {document && <div className="upload-success" role="status"><span className="success-check">✓</span><span><strong>{document.originalName}</strong><small>{(document.sizeBytes / 1024).toFixed(0)} KB · Stored privately on this server</small></span><a className="ghost-btn" href={apiUrl(document.downloadUrl)}>{document.originalName ? 'Download' : 'Open'}</a></div>}
                {document && account.role !== 'viewer' && <button className="ghost-btn" type="button" onClick={() => void runDocumentOcr()} disabled={ocrRunning}>{ocrRunning ? 'Running local OCR…' : 'Extract text with local OCR'}</button>}
                {ocrError && <div className="alert error-alert" role="alert">{ocrError}</div>}
                {ocrResult && <section className="ocr-result" aria-label="OCR result">
                  <span className="section-kicker">OCR TEXT · {ocrResult.provider} {ocrResult.engineVersion}</span>
                  {ocrResult.structuredData && <section className="candidate-fields" aria-label="Extracted invoice fields">
                    <div className="candidate-heading"><strong>Suggested invoice fields</strong><span>Human review required</span></div>
                    {ocrResult.structuredData.documentType === 'unknown'
                      ? <p className="muted">No labeled invoice fields were recognized. Review the source text and enter the details manually.</p>
                      : <>
                        <dl className="candidate-list">
                          {Object.entries(ocrResult.structuredData.fields).map(([name, field]) => (
                            <div key={name} className="candidate-field">
                              <dt>{name.replace(/([A-Z])/g, ' $1')}</dt>
                              <dd>{field.value === null ? 'Not found' : String(field.value)}</dd>
                              {field.evidence && <small>Page {field.pageNumber}: {field.evidence} · {Math.round(field.confidence * 100)}% label match</small>}
                            </div>
                          ))}
                        </dl>
                        <button className="ghost-btn" type="button" onClick={applyExtractedFields}>Review these fields in the invoice form</button>
                      </>}
                    {ocrResult.structuredData.notes.map((note) => <p className="candidate-note" key={note}>{note}</p>)}
                  </section>}
                  {ocrResult.pages.map((page) => <details key={page.pageNumber} open>
                    <summary>Page {page.pageNumber}</summary>
                    <pre>{page.text || 'No text was detected on this page.'}</pre>
                  </details>)}
                </section>}
              </section>

              <section className="panel review-panel">
                <div className="section-title">
                  <div><span className="section-kicker">INVOICE REVIEW</span><h2>{selectedId ? 'Review saved invoice' : 'Enter invoice details'}</h2></div>
                  <div className="review-actions">
                    <button className="text-btn" onClick={startNewInvoice} disabled={account.role === 'viewer'}>＋ New</button>
                    <span className={`badge ${selectedStatus ?? status}`}>{selectedStatus === 'approved' ? 'Approved' : selectedStatus === 'rejected' ? 'Rejected' : status === 'verified' ? 'Validated' : 'Needs review'}</span>
                    <button className="primary-btn compact" onClick={handleSubmit} disabled={loading || account.role === 'viewer'}>{loading ? 'Saving…' : selectedId ? 'Update & re-review' : 'Validate & save'}</button>
                  </div>
                </div>
                {account.role === 'viewer' && <p className="muted">Viewer access is read-only.</p>}
                <div className="invoice-fields">
                  <label>Invoice number<input value={invoice.invoiceNumber} onChange={(e) => setInvoice({ ...invoice, invoiceNumber: e.target.value })} /></label>
                  <label>Supplier<input value={invoice.supplier} onChange={(e) => setInvoice({ ...invoice, supplier: e.target.value })} /></label>
                  <label>Issue date<input type="date" value={invoice.issueDate} onChange={(e) => setInvoice({ ...invoice, issueDate: e.target.value })} /></label>
                  <label>Due date<input type="date" value={invoice.dueDate || ''} onChange={(e) => setInvoice({ ...invoice, dueDate: e.target.value })} /></label>
                  <label>Currency<input value={invoice.currency} maxLength={3} onChange={(e) => setInvoice({ ...invoice, currency: e.target.value.toUpperCase() })} /></label>
                  <label>Subtotal<input type="number" min="0" step="0.01" value={invoice.subtotal} onChange={(e) => setInvoice({ ...invoice, subtotal: Number(e.target.value) })} /></label>
                  <label>Tax<input type="number" min="0" step="0.01" value={invoice.tax} onChange={(e) => setInvoice({ ...invoice, tax: Number(e.target.value) })} /></label>
                  <label>Total<input type="number" min="0" step="0.01" value={invoice.total} onChange={(e) => setInvoice({ ...invoice, total: Number(e.target.value) })} /></label>
                </div>
                <div className="line-items-heading"><h3>Line items</h3><button className="text-btn" onClick={addLineItem} disabled={account.role === 'viewer'}>＋ Add line</button></div>
                <div className="line-table">
                  <div className="line-head"><span>Description</span><span>Qty</span><span>Unit price</span><span>Amount</span></div>
                  {invoice.lineItems.map((item, index) => (
                    <div className="line-row" key={`${item.description}-${index}`}>
                      <input aria-label={`Item ${index + 1} description`} value={item.description} onChange={(e) => updateLineItem(index, 'description', e.target.value)} disabled={account.role === 'viewer'} />
                      <input aria-label={`Item ${index + 1} quantity`} type="number" min="0" step="any" value={item.quantity} onChange={(e) => updateLineItem(index, 'quantity', e.target.value)} disabled={account.role === 'viewer'} />
                      <input aria-label={`Item ${index + 1} unit price`} type="number" min="0" step="0.01" value={item.unitPrice} onChange={(e) => updateLineItem(index, 'unitPrice', e.target.value)} disabled={account.role === 'viewer'} />
                      <input aria-label={`Item ${index + 1} amount`} type="number" min="0" step="0.01" value={item.amount} onChange={(e) => updateLineItem(index, 'amount', e.target.value)} disabled={account.role === 'viewer'} />
                    </div>
                  ))}
                </div>
                <div className="totals-row"><span>Items subtotal <strong>{money(totalFromItems, invoice.currency)}</strong></span><span>Tax <strong>{money(invoice.tax, invoice.currency)}</strong></span><span>Invoice total <strong>{money(invoice.total, invoice.currency)}</strong></span></div>
                {warnings.length > 0 && <div className="alert warning-alert" role="alert"><strong>Review required</strong><ul>{warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></div>}
                {selectedId && selectedStatus === 'needs_review' && account.role !== 'viewer' && (
                  <div className="workflow-actions">
                    <label>Review reason<input value={reviewReason} maxLength={1000} onChange={(event) => setReviewReason(event.target.value)} placeholder="Add a reason for this decision" /></label>
                    <button className="ghost-btn" disabled={loading || reviewReason.trim().length < 3} onClick={() => void transitionInvoice('rejected')}>Reject</button>
                    <button className="primary-btn compact" disabled={loading || reviewReason.trim().length < 3} onClick={() => void transitionInvoice('approved')}>Approve</button>
                  </div>
                )}
                {selectedId && selectedStatus === 'rejected' && account.role !== 'viewer' && (
                  <div className="workflow-actions">
                    <label>Return reason<input value={reviewReason} maxLength={1000} onChange={(event) => setReviewReason(event.target.value)} placeholder="Explain why this invoice should be reviewed again" /></label>
                    <button className="primary-btn compact" disabled={loading || reviewReason.trim().length < 3} onClick={() => void transitionInvoice('needs_review')}>Return to review</button>
                  </div>
                )}
                {selectedId && (
                  <div className="history-panel">
                    <h3>Review history</h3>
                    {historyError && <p className="muted">{historyError}</p>}
                    {!historyError && reviewHistory.length === 0 && <p className="muted">No review events yet.</p>}
                    {reviewHistory.map((event, index) => <p className="history-entry" key={`${event.createdAt}-${index}`}><strong>{event.action === 'created' ? 'Invoice submitted' : event.action === 'fields_updated' ? 'Invoice fields updated' : `${event.fromStatus ?? ''} → ${event.toStatus ?? ''}`}</strong><span>{event.userName} · {new Date(event.createdAt).toLocaleString()}</span>{event.changes.fields && <small>Updated: {event.changes.fields.join(', ')}</small>}{event.reason && <small>{event.reason}</small>}</p>)}
                  </div>
                )}
              </section>
            </div>

            <aside className="panel queue-panel" id="review-queue">
              <div className="section-title"><div><span className="section-kicker">YOUR WORKSPACE</span><h2>Recent invoices</h2></div><span className="queue-count">{queue.length}</span></div>
              <div className="queue-list">
                {queue.length === 0 ? <p className="muted">No saved invoices yet. Enter the details and validate to create one.</p> : queue.map((item, index) => (
                  <button key={item.id} className={`queue-item ${item.id === selectedId ? 'selected' : ''}`} onClick={() => void selectInvoice(item)}>
                    <span className={`invoice-icon ${index % 3 === 0 ? 'mint' : index % 3 === 1 ? 'lavender' : 'peach'}`}>▤</span>
                    <span className="queue-detail"><strong>{item.supplier}</strong><small>{item.invoiceNumber} · {item.status.replace('_', ' ')}</small></span>
                    <span className="queue-amount">{item.total.toLocaleString()}<small>{item.currency}</small></span>
                  </button>
                ))}
              </div>
              <button className="view-all-btn" onClick={() => fileInput.current?.click()}>＋ Add another document</button>
              <div className="confidence-card"><span className="section-kicker">CURRENT INVOICE</span><div className="confidence-meter"><span style={{ width: `${Math.round(confidence * 100)}%` }} /></div><div className="confidence-label"><span>Validation confidence</span><strong>{Math.round(confidence * 100)}%</strong></div><p>Confidence reflects deterministic checks only. It is not an OCR accuracy score.</p></div>
            </aside>
          </section>
          <footer className="footer"><span>FinSight <span className="footer-dot">·</span> Finance operations, with clarity.</span><span>Invoice data is private to your organization.</span></footer>
        </div>
      </main>
    </div>
  );
}
