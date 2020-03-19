const got = require("got");
const fs = require("fs-extra");
const revisionHash = require("rev-hash");
const cliProgress = require("cli-progress");

const multibar = new cliProgress.MultiBar(
  {
    format:
      "Loading [{bar}] {filename} | {duration}sec | {value}/{total} Bytes",
    stopOnComplete: true,
    clearOnComplete: false,
    hideCursor: true
  },
  cliProgress.Presets.shades_grey
);

function isNumber(val) {
  return typeof val === "number";
}

class HttpProxy {
  constructor(options) {
    // combine options with defaults
    this._options = exports.defaults;
    this._options = Object.assign({}, this._options, options);
    // define working directory
    this._options.workDir = process.cwd() + this._options.baseDir;
    // ensure that workDir exists
    fs.ensureDirSync(this._options.workDir);
    // lookup cache file
    this.readCacheFile();

    console.log(this._options);
  }

  async fetchJson(url) {
    // lookup URL from cache
    const data = this.get(url);
    if (data) {
      this.info(`Cache hit for ${url}`);
      return JSON.parse(data);
    }
    // otherwise fetch data from URL
    const json = await got(url, {
      headers: { Accept: "application/sparql-results+json" }
    }).json();
    // save json to disk
    const hash = revisionHash(url);
    const path = this.getPath(hash);
    this.saveFile(path, JSON.stringify(json));
    this.put(hash, path, this._options.ttl);
    // return json
    return json;
  }

  async download(downloads) {
    await Promise.all(
      downloads.map(download =>
        this.save2disk(
          download.uri,
          download.fileDir,
          download.filename
        ).catch(error =>
          console.error(
            `Saving ${download.uri} to ${download.path} failed: ${error}`
          )
        )
      )
    );
    // finally stop any progress bar
    multibar.stop();
  }

  async save2disk(url, fileDir, filename) {
    // lookup URL from cache
    const data = this.get(url);
    if (data) {
      this.info(`Cache hit for ${url}`);
      return data;
    }
    // otherwise fetch data from URL
    var bar;
    // create write stream
    const path = fileDir + filename;
    const writer = fs.createWriteStream(path);
    // start request
    const response = await got
      .stream(url)
      .on("response", response => {
        // in verbose mode get content length to initialize progress bar
        if (this._options.verbose) {
          let totalLength = 0;
          let contentLength = response.headers["content-length"];
          if (contentLength) {
            totalLength = parseInt(contentLength, 10);
          }
          bar = multibar.create(totalLength, 0, {
            filename: filename
          });
        }
      })
      .on("downloadProgress", progress => {
        // in verbose mode update progress bar
        if (this._options.verbose && bar) {
          bar.update(progress.transferred);
        }
      });
    // pipe data stream to disk
    response.pipe(writer);
    return new Promise((resolve, reject) => {
      writer.on("finish", () => {
        const hash = revisionHash(url);
        this.put(hash, path, this._options.ttl);
        resolve();
      });
      writer.on("error", err => {
        fs.unlink(path);
        reject(err);
      });
    });
  }

  get(url) {
    const data = this._cache.get(revisionHash(url));
    if (data) {
      // verify ttl
      if (data.ttl && data.ttl < Date.now()) {
        this.warn(`Cache hit expired for ${url}`);
        return;
      }
      // return value from disk
      return this.readFile(data.path);
    }
    return;
  }

  put(hash, path, ttl) {
    // use 0 as undefined setting
    if (ttl === 0) {
      ttl = undefined;
    }
    // update cache
    this._cache.set(hash, {
      path: path,
      ttl: isNumber(ttl) ? Date.now() + ttl : undefined
    });
    // save cache to file
    this.saveCacheFile();
  }

  // TODO !!!
  getPath(hash) {
    const data = this._cache.get(hash);
    if (data) {
      return data.path;
    } else {
      return `${this._options.workDir}file${this._cache.size}.cache`;
    }
  }

  readFile(path) {
    try {
      return fs.readFileSync(path);
    } catch (err) {
      return;
    }
  }

  saveFile(path, value) {
    return new Promise((resolve, reject) => {
      fs.outputFile(path, value, err => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  readCacheFile() {
    const file = this._options.workDir + this._options.cacheFile;
    try {
      const json = fs.readJsonSync(file);
      this._cache = new Map(json.cache);
    } catch (err) {
      this._cache = new Map();
    }
  }

  saveCacheFile() {
    const file = this._options.workDir + this._options.cacheFile;
    // save cache to file - TODO incremental update
    const json = { cache: [] };
    for (const [key, value] of this._cache) {
      json.cache.push([key, value]);
    }
    return new Promise((resolve, reject) => {
      fs.outputJson(file, json, err => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  info(...msgs) {
    if (this._options.verbose) console.log(...msgs);
  }

  warn(...msgs) {
    if (this._options.verbose) console.warn(...msgs);
  }
}

exports.defaults = {
  baseDir: "/content/",
  cacheFile: ".cache.json",
  cacheEnabled: true,
  ttl: 60 * 60 * 1000, // 1h
  verbose: false
};

module.exports = HttpProxy;
