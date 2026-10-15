// Thin client for the Python JSON API (docs/ARCHITECTURE.md, section 5).
// Set ?mock=1 in the URL to use the in-browser mock (development only).

export const USE_MOCK = new URLSearchParams(location.search).get('mock') === '1';

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

let mockModule = null;

async function request(method, path, body) {
  if (USE_MOCK) {
    mockModule ??= await import('./mock-api.js');
    const { status, data } = mockModule.handle(method, path, body);
    if (status >= 400) throw new ApiError(data.error ?? `HTTP ${status}`, status);
    return structuredClone(data);
  }

  const init = { method, headers: { Accept: 'application/json' } };
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }

  let res;
  try {
    // Relative URL: the Python server serves frontend/ at "/" and the API at "/api".
    res = await fetch(`api${path}`, init);
  } catch {
    throw new ApiError('Cannot reach the server. Is "python run.py" running?', 0);
  }

  let data = null;
  try {
    data = await res.json();
  } catch {
    if (!res.ok) throw new ApiError(`HTTP ${res.status} ${res.statusText}`, res.status);
    throw new ApiError('The server returned an invalid JSON response.', res.status);
  }
  if (!res.ok) throw new ApiError(data?.error ?? `HTTP ${res.status}`, res.status);
  return data;
}

export const api = {
  state: () => request('GET', '/state'),
  order: (direction) => request('GET', `/wheel/order?direction=${direction}`),
  pocket: (n) => request('GET', `/pockets/${encodeURIComponent(n)}`),
  addPlayer: (name, balance) => request('POST', '/players', { name, balance }),
  removePlayer: (name) => request('DELETE', `/players/${encodeURIComponent(name)}`),
  placeBet: (player, type, value, amount) => request('POST', '/bets', { player, type, value, amount }),
  cancelBet: (id) => request('DELETE', `/bets/${encodeURIComponent(id)}`),
  spin: (steps = {}) => request('POST', '/spin', steps),
  moveCursor: (direction) => request('POST', '/history/cursor', { direction }),
  reset: (demo = false) => request('POST', '/reset', demo ? { demo: true } : {}),
};
