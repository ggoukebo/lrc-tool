export type StoredFile = {
  name: string
  file: File
}

export const fileStorage = {
  db: null as IDBDatabase | null,

  // 初始化数据库
  async init(): Promise<IDBDatabase> {
    if (this.db) return this.db

    return new Promise((resolve, reject) => {
      const request = indexedDB.open('FileDB', 1)

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result
        if (!db.objectStoreNames.contains('files')) {
          db.createObjectStore('files', { keyPath: 'name' })
        }
      }

      request.onsuccess = (event) => {
        this.db = (event.target as IDBOpenDBRequest).result
        resolve(this.db)
      }

      request.onerror = (event) => reject((event.target as IDBOpenDBRequest).error)
    })
  },

  // 保存文件
  /*async saveFile(file: File, name: string = file.name): Promise<void> {
    const db = await this.init()
    return new Promise((resolve, reject) => {
      const tx = db.transaction('files', 'readwrite')
      const store = tx.objectStore('files')

      store.put({ name, file })

      tx.oncomplete = () => resolve()
      tx.onerror = (event) => reject((event.target as IDBTransaction).error)
    })
  },*/
  export function saveLrcFile(content: string, filename: string = 'lyrics.lrc') {
  // 创建 UTF-8 编码的 Blob 对象
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  
  // 创建隐藏的 a 标签触发下载
  const a = document.createElement('a')
  a.href = url
  a.download = filename.endsWith('.lrc') ? filename : `${filename}.lrc`
  document.body.appendChild(a)
  a.click()
  
  // 清理 DOM 和内存
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

  // 读取文件
  async loadFile(fileName: string): Promise<File | null> {
    const db = await this.init()
    return new Promise((resolve, reject) => {
      const tx = db.transaction('files', 'readonly')
      const store = tx.objectStore('files')

      const request = store.get(fileName)

      request.onsuccess = (event) => {
        const result = (event.target as IDBRequest<StoredFile>).result
        resolve(result ? result.file : null)
      }

      request.onerror = (event) => reject((event.target as IDBRequest).error)
    })
  },

  // 列出所有文件名
  async listFiles(): Promise<string[]> {
    const db = await this.init()
    return new Promise((resolve, reject) => {
      const tx = db.transaction('files', 'readonly')
      const store = tx.objectStore('files')

      const request = store.getAllKeys()

      request.onsuccess = (event) => resolve((event.target as IDBRequest<string[]>).result)
      request.onerror = (event) => reject((event.target as IDBRequest).error)
    })
  },

  // 删除指定文件
  async deleteFile(fileName: string): Promise<void> {
    const db = await this.init()
    return new Promise((resolve, reject) => {
      const tx = db.transaction('files', 'readwrite')
      const store = tx.objectStore('files')

      const request = store.delete(fileName)

      request.onsuccess = () => resolve()
      request.onerror = (event) => reject((event.target as IDBRequest).error)
    })
  },

  // 清空所有文件
  async clearFiles(): Promise<void> {
    const db = await this.init()
    return new Promise((resolve, reject) => {
      const tx = db.transaction('files', 'readwrite')
      const store = tx.objectStore('files')

      const request = store.clear()

      request.onsuccess = () => resolve()
      request.onerror = (event) => reject((event.target as IDBRequest).error)
    })
  },
}
