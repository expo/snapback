// HTTP client for the Snapback headless admin API (`/_snapback/api/*`).
//
// The admin console is a *system app*: it talks to this privileged admin
// contract, never to ordinary app tables through generated application
// functions. That keeps it usable even when the app's own schema/functions are
// broken — the bootstrap property LLP 0017 requires.

export class AdminClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.token = (typeof localStorage !== 'undefined' && localStorage.getItem('snapback_admin_token')) || '';
  }

  async #req(method, path, body) {
    const headers = {};
    if (this.token) headers['x-snapback-admin-token'] = this.token;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const res = await fetch(this.baseUrl + path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    // @ref LLP 0032#confirmed-defect-register — S5.D3: check status before
    //   trusting the body as JSON, so a proxy 502 HTML page surfaces as a
    //   structured diagnostic instead of a bare SyntaxError.
    let json = null;
    let parseError = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch (error) {
        parseError = error;
      }
    }
    if (!res.ok) {
      const d = json && json.diagnostic
        ? json.diagnostic
        : parseError
          ? { code: 'SNAPBACK_HTTP_ERROR', message: `HTTP ${res.status} with non-JSON body: ${bodySnippet(text)}` }
          : { code: `HTTP_${res.status}`, message: text };
      const error = new Error(`${d.code}: ${d.message ?? ''}`);
      error.diagnostic = d;
      throw error;
    }
    if (parseError) {
      const d = { code: 'SNAPBACK_RESPONSE_NOT_JSON', message: `HTTP ${res.status} response is not JSON: ${bodySnippet(text)}` };
      const error = new Error(`${d.code}: ${d.message}`);
      error.diagnostic = d;
      throw error;
    }
    return json;
  }

  inspect() {
    return this.#req('GET', '/inspect');
  }

  scanTable(table, limit = 50, offset = 0) {
    return this.#req('GET', `/data/${encodeURIComponent(table)}?limit=${limit}&offset=${offset}`);
  }

  runFunction(name, input) {
    return this.#req('POST', `/functions/${encodeURIComponent(name)}/run`, input);
  }

  cleanupEphemeral() {
    return this.#req('POST', '/ephemeral/cleanup');
  }
}

function bodySnippet(text, limit = 200) {
  const collapsed = String(text ?? '').replace(/\s+/g, ' ').trim();
  return collapsed.length <= limit ? collapsed : `${collapsed.slice(0, limit)}…`;
}
