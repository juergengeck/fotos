/**
 * Patched native-universal-fs for React Native / Expo.
 *
 * The original native-universal-fs has a bug where it reads documentDirectory
 * at module load time, before the native module is ready. This causes
 * transformers.js to crash with "Path must be a string. Received undefined".
 *
 * This shim lazily resolves the paths on first access.
 */

console.log('[native-universal-fs] Shim loading...');

let _fs = null;
let _isExpo = false;
let _isLoaded = false;

function getFs() {
  if (_fs) return _fs;

  if (typeof navigator !== "undefined" && navigator.product === "ReactNative") {
    try {
      _fs = require("@dr.pogodin/react-native-fs");
      if (_fs.DocumentDirectoryPath) {
        _isLoaded = true;
        return _fs;
      }
    } catch {}

    try {
      _fs = require("react-native-fs");
      if (_fs.DocumentDirectoryPath) {
        _isLoaded = true;
        return _fs;
      }
    } catch {}

    try {
      // Use legacy API from expo-file-system
      _fs = require("expo-file-system/src/legacy");
      _isExpo = true;
      if (_fs.documentDirectory) {
        _isLoaded = true;
      }
    } catch {}
  }

  if (!_fs) {
    _fs = {};
  }

  return _fs;
}

const join = (...paths) => paths.join("/").replace("//", "/");
const normalize = (path) => _isExpo && path && path.startsWith("/") ? `file://${path}` : path;
const basename = (path) => path ? path.split("/").pop() : '';

// Fallback paths for when expo-file-system isn't ready yet
// These are valid paths that won't cause path.join() to crash
const FALLBACK_DOC_DIR = '/tmp/transformers-docs/';
const FALLBACK_CACHE_DIR = '/tmp/transformers-cache/';

// Lazy getters for directory paths with fallbacks
Object.defineProperty(module.exports, 'TemporaryDirectoryPath', {
  get() {
    const fs = getFs();
    const path = _isExpo ? fs.cacheDirectory : fs.TemporaryDirectoryPath;
    return path || FALLBACK_CACHE_DIR;
  }
});

Object.defineProperty(module.exports, 'DocumentDirectoryPath', {
  get() {
    console.log('[native-universal-fs] DocumentDirectoryPath getter called');
    const fs = getFs();
    const path = _isExpo ? fs.documentDirectory : fs.DocumentDirectoryPath;
    console.log('[native-universal-fs] DocumentDirectoryPath =', path);
    if (!path) {
      console.warn('[native-universal-fs] DocumentDirectoryPath not ready, using fallback');
    }
    return path || FALLBACK_DOC_DIR;
  }
});

Object.defineProperty(module.exports, 'CachesDirectoryPath', {
  get() {
    const fs = getFs();
    const path = _isExpo ? fs.cacheDirectory : fs.CachesDirectoryPath;
    return path || FALLBACK_CACHE_DIR;
  }
});

// File operations
const readFile = (path, encoding = "utf8") => {
  const fs = getFs();
  if (_isExpo) {
    return fs.readAsStringAsync(normalize(path), { encoding });
  }
  return fs.readFile(path, encoding);
};

const writeFile = (path, data, encoding = "utf8") => {
  const fs = getFs();
  if (_isExpo) {
    return fs.writeAsStringAsync(normalize(path), data, { encoding });
  }
  return fs.writeFile(path, data, encoding);
};

const appendFile = (path, data, encoding = "utf8") => {
  const fs = getFs();
  if (_isExpo) {
    throw new Error("`appendFile` not supported on Expo");
  }
  return fs.appendFile(path, data, encoding);
};

const write = (path, data, position = 0, encoding = "utf8") => {
  const fs = getFs();
  if (_isExpo) {
    throw new Error("`write` not supported on Expo");
  }
  return fs.write(path, data, position, encoding);
};

const readdir = (path) => {
  const fs = getFs();
  if (_isExpo) {
    return fs.readDirectoryAsync(normalize(path));
  }
  return fs.readdir(path);
};

const readDir = async (path) => {
  const fs = getFs();
  if (_isExpo) {
    const files = await fs.readDirectoryAsync(normalize(path));
    return Promise.all(files.map((item) => stat(join(path, item))));
  }
  return fs.readDir(path);
};

const mkdir = (path) => {
  const fs = getFs();
  if (_isExpo) {
    return fs.makeDirectoryAsync(normalize(path), { intermediates: true });
  }
  return fs.mkdir(path);
};

const unlink = (path) => {
  const fs = getFs();
  if (_isExpo) {
    return fs.deleteAsync(normalize(path));
  }
  return fs.unlink(path);
};

const moveFile = (path, newPath) => {
  const fs = getFs();
  if (_isExpo) {
    return fs.moveAsync({ from: normalize(path), to: normalize(newPath) });
  }
  return fs.moveFile(path, newPath);
};

const copyFile = (path, newPath) => {
  const fs = getFs();
  if (_isExpo) {
    return fs.copyAsync({ from: normalize(path), to: normalize(newPath) });
  }
  return fs.copyFile(path, newPath);
};

const stat = async (path) => {
  const fs = getFs();
  if (_isExpo) {
    const { exists, isDirectory, modificationTime, size, uri } = await fs.getInfoAsync(normalize(path));
    if (!exists) {
      throw new Error("File does not exist");
    }
    return {
      name: basename(path),
      isDirectory: () => isDirectory,
      isFile: () => !isDirectory,
      mtime: new Date(modificationTime),
      originalFilepath: uri,
      path: uri.replace("file://", ""),
      size,
    };
  }
  return fs.stat(path);
};

const exists = async (path) => {
  const fs = getFs();
  if (_isExpo) {
    const info = await fs.getInfoAsync(normalize(path));
    return info.exists;
  }
  return fs.exists(path);
};

// Download and upload
const jobs = {};
let nextJobId = 0;

const downloadFile = (options) => {
  const fs = getFs();
  if (_isExpo) {
    let bytesWritten = 0;
    let contentLength = 0;
    const {
      fromUrl,
      toFile,
      headers,
      background,
      cacheable,
      progress,
    } = options;
    const jobId = nextJobId++;
    const job = fs.createDownloadResumable(fromUrl, toFile, {
      cache: cacheable,
      headers,
      sessionType: background ? 0 : 1,
    }, ({ totalBytesExpectedToWrite, totalBytesWritten }) => {
      bytesWritten = totalBytesWritten;
      contentLength = totalBytesExpectedToWrite;
      progress?.({ jobId, bytesWritten, contentLength });
    });
    jobs[jobId] = job;
    return {
      jobId,
      promise: job.downloadAsync().then(() => {
        delete jobs[jobId];
        return {
          jobId,
          bytesWritten,
          statusCode: 200,
        };
      }).catch((error) => {
        delete jobs[jobId];
        throw error;
      }),
    };
  }
  return fs.downloadFile(options);
};

const stopDownload = async (jobId) => {
  const fs = getFs();
  if (_isExpo) {
    const job = jobs[jobId];
    if (!job) {
      return;
    }
    await job.cancelAsync();
    delete jobs[jobId];
  }
  return fs.stopDownload(jobId);
};

const uploadFiles = (options) => {
  const fs = getFs();
  if (_isExpo) {
    const {
      toUrl,
      files,
      method,
      headers,
      fields,
      progress,
      background,
    } = options;
    if (fields) {
      throw new Error("`fields` not supported on Expo");
    }
    if (files.length > 1) {
      throw new Error("Expo not support multiple files upload");
    }
    const file = files[0];
    const jobId = nextJobId++;
    const job = fs.createUploadTask(file.filepath, toUrl, {
      headers,
      httpMethod: method,
      sessionType: background ? 0 : 1,
    }, ({ totalBytesExpectedToSend, totalBytesSent }) => {
      progress?.({ jobId, totalBytesSent, totalBytesExpectedToSend });
    });
    jobs[jobId] = job;
    return {
      jobId,
      promise: job.uploadAsync().then(({ body }) => {
        delete jobs[jobId];
        return {
          jobId,
          statusCode: 200,
          headers: {},
          body,
        };
      }).catch((error) => {
        delete jobs[jobId];
        throw error;
      }),
    };
  }
  return fs.uploadFiles(options);
};

const stopUpload = async (jobId) => {
  const fs = getFs();
  if (_isExpo) {
    const job = jobs[jobId];
    if (!job) {
      return;
    }
    await job.cancelAsync();
    delete jobs[jobId];
  }
  return fs.stopUpload(jobId);
};

// Export functions
module.exports.readFile = readFile;
module.exports.writeFile = writeFile;
module.exports.write = write;
module.exports.appendFile = appendFile;
module.exports.readdir = readdir;
module.exports.readDir = readDir;
module.exports.mkdir = mkdir;
module.exports.unlink = unlink;
module.exports.moveFile = moveFile;
module.exports.copyFile = copyFile;
module.exports.stat = stat;
module.exports.exists = exists;
module.exports.downloadFile = downloadFile;
module.exports.stopDownload = stopDownload;
module.exports.uploadFiles = uploadFiles;
module.exports.stopUpload = stopUpload;
