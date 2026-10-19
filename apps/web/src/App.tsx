import { useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from 'react';

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

type UploadedDocument = {
  id: string;
  originalName: string;
  contentType: string;
  sizeBytes: number;
  status: string;
  downloadUrl: string;
};

const initialInvoice: ParsedInvoice = {
  invoiceNumber: 'INV-2026-0104',
  supplier: 'Northwind Traders',
  issueDate: '2026-10-01',
  dueDate: '2026-10-15',
  currency: 'USD',
  subtotal: 1250,
  tax: 125,
  total: 1375,
  lineItems: [
    { description: 'Five desktops', quantity: 5, unitPrice: 200, amount: 1000 },
    { description: 'Accessories', quantity: 1, unitPrice: 250, amount: 250 },
  ],
};

const apiUrl = (path: string) => `${import.meta.env.VITE_API_URL ?? ''}${path}`;

export default function App() {
  const [invoice, setInvoice] = useState<ParsedInvoice>(initialInvoice);
  const [queue, setQueue] = useState<ParsedInvoice[]>([]);
  const [status, setStatus] = useState<'verified' | 'needs_review'>('verified');
  const [confidence, setConfidence] = useState<number>(0.96);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [apiError, setApiError] = useState('');
  const [document, setDocument] = useState<UploadedDocument | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const loadDemoInvoices = async () => {
      try {
        const response = await fetch(apiUrl('/api/invoices/demo'));
        if (!response.ok) throw new Error(`Could not load invoices (HTTP ${response.status}).`);
        const payload = await response.json();
        setQueue(payload.data ?? []);
        setApiError('');
      } catch (error) {
        setApiError(error instanceof Error ? error.message : 'Could not connect to the FinSight API.');
      }
    };

    void loadDemoInvoices();
  }, []);

  const totalFromItems = useMemo(
    () => invoice.lineItems.reduce((sum, item) => sum + item.amount, 0),
    [invoice.lineItems],
  );

  const handleSubmit = async () => {
    setLoading(true);
    setApiError('');
    try {
      const response = await fetch(apiUrl('/api/invoices/parse'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(invoice),
      });
      const payload = await response.json();

      if (!response.ok) {
        setWarnings(payload.errors ? ['Review the invoice fields and correct validation errors.'] : [payload.message]);
        setStatus('needs_review');
        setConfidence(0.4);
        return;
      }

      setWarnings(payload.warnings);
      setStatus(payload.status);
      setConfidence(payload.confidence);
      setQueue((previous) => [invoice, ...previous.filter((item) => item.invoiceNumber !== invoice.invoiceNumber)]);
    } catch (error) {
      setApiError(error instanceof Error ? error.message : 'Could not verify this invoice.');
    } finally {
      setLoading(false);
    }
  };

  const uploadDocument = async (file: File) => {
    setUploading(true);
    setUploadError('');
    setDocument(null);
    try {
      const body = new FormData();
      body.append('file', file);
      const response = await fetch(apiUrl('/api/documents'), { method: 'POST', body });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? 'Upload failed.');
      setDocument(payload.data);
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : 'Could not upload this document.');
    } finally {
      setUploading(false);
    }
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

  const preventDragNavigation = (event: DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
  };

  const updateLineItem = (index: number, field: keyof InvoiceItem, value: string | number) => {
    const nextItems = invoice.lineItems.map((item, itemIndex) => {
      if (itemIndex !== index) return item;
      const safeValue = field === 'description' ? String(value) : Number(value);
      return { ...item, [field]: safeValue };
    });
    setInvoice({ ...invoice, lineItems: nextItems });
  };

  const addLineItem = () => {
    setInvoice({
      ...invoice,
      lineItems: [...invoice.lineItems, { description: 'New line item', quantity: 1, unitPrice: 0, amount: 0 }],
    });
  };

  const selectInvoice = (selected: ParsedInvoice) => {
    setInvoice(selected);
    setStatus('verified');
    setWarnings([]);
    setConfidence(0.96);
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="FinSight home">
          <span className="brand-mark">F</span>
          <span>FinSight</span>
        </a>
        <p className="nav-label">WORKSPACE</p>
        <a className="nav-link active" href="#overview"><span>◫</span> Overview</a>
        <a className="nav-link" href="#review-queue"><span>▤</span> Invoices <span className="nav-count">{queue.length}</span></a>
        <a className="nav-link" href="#upload"><span>⇧</span> Upload documents</a>
        <div className="sidebar-bottom">
          <div className="secure-note"><span className="secure-dot" /> Demo workspace</div>
          <div className="user-chip"><span className="avatar">FS</span><span><strong>Finance team</strong><small>Workspace admin</small></span></div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="breadcrumbs">Workspace <span>/</span> <strong>Overview</strong></div>
          <div className="topbar-actions"><span className="today-label">Finance operations</span><span className="avatar">FS</span></div>
        </header>

        <div className="content">
          <section className="page-heading" id="overview">
            <div>
              <p className="eyebrow">MONDAY, OCTOBER 19</p>
              <h1>Good morning, team <span className="wave">✦</span></h1>
              <p className="subtitle">Your invoice operations at a glance.</p>
            </div>
            <button className="primary-btn" onClick={() => fileInput.current?.click()}>＋ Upload invoice</button>
          </section>

          {apiError && <div className="alert error-alert" role="alert">{apiError} Start the API with <code>npm run dev</code>.</div>}

          <section className="stats-grid" aria-label="Invoice metrics">
            <article className="stat-card"><div className="stat-top"><span className="stat-icon indigo">▤</span><span className="stat-trend neutral">Demo</span></div><span className="stat-label">Illustrative invoices</span><strong className="stat-value">{queue.length.toString().padStart(2, '0')}</strong><span className="stat-foot">Not persisted records</span></article>
            <article className="stat-card"><div className="stat-top"><span className="stat-icon amber">≡</span><span className="stat-trend neutral">Selected invoice</span></div><span className="stat-label">Line items</span><strong className="stat-value">{invoice.lineItems.length.toString().padStart(2, '0')}</strong><span className="stat-foot">In the current review form</span></article>
            <article className="stat-card"><div className="stat-top"><span className="stat-icon green">✓</span><span className={`stat-trend ${status === 'verified' ? '' : 'neutral'}`}>Rule checks</span></div><span className="stat-label">Current validation</span><strong className="stat-value">{status === 'verified' ? 'Pass' : 'Review'}</strong><span className="stat-foot">Not an approval or OCR result</span></article>
            <article className="stat-card total-card"><div className="stat-top"><span className="stat-icon pale">＄</span><span className="stat-trend neutral">Selected</span></div><span className="stat-label">Current invoice total</span><strong className="stat-value">{invoice.total.toLocaleString()} <small>{invoice.currency}</small></strong><span className="stat-foot">Illustrative invoice value</span></article>
          </section>

          <section className="workspace-grid">
            <div className="main-column">
              <section className="panel upload-panel" id="upload">
                <div className="section-title">
                  <div><span className="section-kicker">DOCUMENT INTAKE</span><h2>Bring your invoices together</h2></div>
                  <span className="file-limit">PDF · PNG · JPG · WEBP</span>
                </div>
                <button className="dropzone" type="button" onClick={() => fileInput.current?.click()} onDragOver={preventDragNavigation} onDrop={handleDrop} disabled={uploading}>
                  <span className="upload-icon">⇧</span>
                  <strong>{uploading ? 'Uploading…' : 'Drop a file here, or browse'}</strong>
                  <span>Maximum file size 12 MB. Stored on this server; OCR is not configured.</span>
                </button>
                <input ref={fileInput} className="visually-hidden" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp" onChange={handleUpload} />
                {uploadError && <div className="alert error-alert" role="alert">{uploadError}</div>}
                {document && (
                  <div className="upload-success" role="status">
                    <span className="success-check">✓</span>
                    <span><strong>{document.originalName}</strong><small>{(document.sizeBytes / 1024).toFixed(0)} KB · Stored locally · OCR not configured</small></span>
                    <a className="ghost-btn" href={apiUrl(document.downloadUrl)}>Download</a>
                  </div>
                )}
              </section>

              <section className="panel review-panel">
                <div className="section-title">
                  <div><span className="section-kicker">INVOICE REVIEW</span><h2>Review extracted details</h2></div>
                  <div className="review-actions"><span className={`badge ${status}`}>{status === 'verified' ? 'Verified' : 'Needs review'}</span><button className="primary-btn compact" onClick={handleSubmit} disabled={loading}>{loading ? 'Checking…' : 'Run checks'}</button></div>
                </div>
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
                <div className="line-items-heading"><h3>Line items</h3><button className="text-btn" onClick={addLineItem}>＋ Add line</button></div>
                <div className="line-table">
                  <div className="line-head"><span>Description</span><span>Qty</span><span>Unit price</span><span>Amount</span></div>
                  {invoice.lineItems.map((item, index) => (
                    <div className="line-row" key={`${item.description}-${index}`}>
                      <input aria-label={`Item ${index + 1} description`} value={item.description} onChange={(e) => updateLineItem(index, 'description', e.target.value)} />
                      <input aria-label={`Item ${index + 1} quantity`} type="number" min="0" step="any" value={item.quantity} onChange={(e) => updateLineItem(index, 'quantity', e.target.value)} />
                      <input aria-label={`Item ${index + 1} unit price`} type="number" min="0" step="0.01" value={item.unitPrice} onChange={(e) => updateLineItem(index, 'unitPrice', e.target.value)} />
                      <input aria-label={`Item ${index + 1} amount`} type="number" min="0" step="0.01" value={item.amount} onChange={(e) => updateLineItem(index, 'amount', e.target.value)} />
                    </div>
                  ))}
                </div>
                <div className="totals-row"><span>Items subtotal <strong>{totalFromItems.toFixed(2)} {invoice.currency}</strong></span><span>Tax <strong>{invoice.tax.toFixed(2)} {invoice.currency}</strong></span><span>Invoice total <strong>{invoice.total.toFixed(2)} {invoice.currency}</strong></span></div>
                {warnings.length > 0 && <div className="alert warning-alert" role="alert"><strong>Review required</strong><ul>{warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></div>}
              </section>
            </div>

            <aside className="panel queue-panel" id="review-queue">
              <div className="section-title"><div><span className="section-kicker">YOUR WORKSPACE</span><h2>Recent invoices</h2></div><span className="queue-count">{queue.length}</span></div>
              <div className="queue-list">
                {queue.length === 0 ? <p className="muted">Loading invoices…</p> : queue.map((item, index) => (
                  <button key={item.invoiceNumber} className={`queue-item ${item.invoiceNumber === invoice.invoiceNumber ? 'selected' : ''}`} onClick={() => selectInvoice(item)}>
                    <span className={`invoice-icon ${index === 0 ? 'mint' : index === 1 ? 'lavender' : 'peach'}`}>▤</span>
                    <span className="queue-detail"><strong>{item.supplier}</strong><small>{item.invoiceNumber} · {item.issueDate}</small></span>
                    <span className="queue-amount">{item.total.toLocaleString()}<small>{item.currency}</small></span>
                  </button>
                ))}
              </div>
              <button className="view-all-btn" onClick={() => fileInput.current?.click()}>＋ Add another document</button>
              <div className="confidence-card"><span className="section-kicker">CURRENT DOCUMENT</span><div className="confidence-meter"><span style={{ width: `${Math.round(confidence * 100)}%` }} /></div><div className="confidence-label"><span>Validation confidence</span><strong>{Math.round(confidence * 100)}%</strong></div><p>Confidence reflects deterministic checks only. It is not an OCR accuracy score.</p></div>
            </aside>
          </section>
          <footer className="footer"><span>FinSight <span className="footer-dot">·</span> Finance operations, with clarity.</span><span>* Demo data — not live financial records.</span></footer>
        </div>
      </main>
    </div>
  );
}
