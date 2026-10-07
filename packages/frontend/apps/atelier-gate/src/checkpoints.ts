// Persistence acknowledgment occurs only after the IndexedDB transaction commits.
export async function storeCheckpoint(bytes: Uint8Array): Promise<void> {
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('checkpoints', 'readwrite');
      tx.objectStore('checkpoints').put(bytes.slice(), 'fixture');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () =>
        reject(tx.error ?? new Error('Checkpoint transaction aborted'));
    });
  } finally {
    db.close();
  }
}

export async function loadCheckpoint(): Promise<Uint8Array> {
  const db = await openDatabase();
  try {
    return await new Promise<Uint8Array>((resolve, reject) => {
      const request = db
        .transaction('checkpoints')
        .objectStore('checkpoints')
        .get('fixture');
      request.onsuccess = () => {
        if (!(request.result instanceof Uint8Array)) {
          reject(new Error('No local checkpoint exists; save first.'));
        } else {
          resolve(request.result);
        }
      };
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('atelier-structured-gate', 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore('checkpoints');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () =>
      reject(new Error('Another tab is blocking the checkpoint database.'));
  });
}
