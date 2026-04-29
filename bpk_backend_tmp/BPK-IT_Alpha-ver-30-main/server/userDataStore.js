class UserDataStore {
  constructor() {
    // Изоляция данных по sessionId, чтобы пользователи не видели чужие загрузки.
    this.bySession = new Map();
  }

  #empty() {
    return { fileName: '', columns: [], rows: [], loadedAt: '' };
  }

  #getBucket(sessionId) {
    if (!this.bySession.has(sessionId)) this.bySession.set(sessionId, this.#empty());
    return this.bySession.get(sessionId);
  }

  clear(sessionId) {
    this.bySession.set(sessionId, this.#empty());
  }

  setData(sessionId, { fileName, columns, rows }) {
    this.bySession.set(sessionId, {
      fileName: fileName || '',
      columns: Array.isArray(columns) ? columns : [],
      rows: Array.isArray(rows) ? rows : [],
      loadedAt: new Date().toISOString(),
    });
  }

  getMeta(sessionId) {
    const b = this.#getBucket(sessionId);
    return {
      hasData: b.rows.length > 0 && b.columns.length > 0,
      fileName: b.fileName,
      rowCount: b.rows.length,
      columns: b.columns,
      loadedAt: b.loadedAt,
    };
  }

  hasData(sessionId) {
    return this.getMeta(sessionId).hasData;
  }

  getRows(sessionId) {
    return this.#getBucket(sessionId).rows;
  }

  getColumns(sessionId) {
    return this.#getBucket(sessionId).columns;
  }
}

export const userDataStore = new UserDataStore();
