const got = require("got");
const fs = require("fs-extra");
const Keyv = require("keyv");
const KeyvFile = require("keyv-file");
const cliProgress = require("cli-progress");

//require('events').EventEmitter.defaultMaxListeners = 100;

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

class WikidataSource {
  constructor(api, options) {
    this.options = options;

    // verify config params ...

    // mandatory params

    if (!this.options.url) {
      throw new Error(
        `Missing 'url' endpoint. Please provide a valid url endpoint.`
      );
    }

    if (!this.options.sparql) {
      throw new Error(
        `Missing 'sparql' query. Please provide a valid sparql query.`
      );
    }

    if (!this.options.typeName) {
      throw new Error(
        `Missing 'typeName' label. Please provide a type name label.`
      );
    }

    // optional params

    if (this.options.verbose === undefined) {
      this.options.verbose = false;
    }

    if (this.options.baseDir === undefined) {
      this.options.baseDir = "/content/media/";
      this.warn(
        `No 'baseDir' provided. Using 'baseDir'=${this.options.baseDir} instead.`
      );
    }

    if (this.options.cacheEnabled === undefined) {
      this.options.cacheEnabled = true;
      this.warn(
        `No 'cacheEnabled' provided. Using 'cacheEnabled'=${this.options.cacheEnabled} instead.`
      );
    }

    if (this.options.cacheExpireTime === undefined) {
      this.options.cacheExpireTime = 24 * 3600 * 1000;
      this.warn(
        `No 'cacheExpireTime' provided. Using 'cacheExpireTime'=${this.options.cacheExpireTime} instead.`
      );
    }

    this.info("options =", this.options);

    // init cache

    if (this.options.cacheEnabled) {
      this.cache = new Keyv({
        store: new KeyvFile({
          filename: `${process.cwd()}${this.options.baseDir}/http-cache.json`, // the file path to store the data
          expiredCheckDelay: this.options.cacheExpireTime, // expire time in ms
          writeDelay: 100,
          encode: JSON.stringify, // serialize function
          decode: JSON.parse // deserialize function
        })
      });
      this.info("cache =", this.cache);
    }

    // start processing

    api.onCreateNode(options => {
      this.info(options);
    });

    api.loadSource(async actions => {
      // fetch data ...
      const downloads = await this.fetchWikidata(actions);
      // download remote URIs ...
      this.info("Starting media download(s) ...");
      await this.download(downloads);
      // finally stop any progress bar
      multibar.stop();
    });
  }

  info(...msgs) {
    if (this.options.verbose) console.log(...msgs);
  }

  warn(...msgs) {
    if (this.options.verbose) console.warn(...msgs);
  }

  async fetchWikidata(actions) {
    const collection = actions.addCollection({
      typeName: this.options.typeName
    });
    const downloads = [];
    const dir = process.cwd() + this.options.baseDir;
    // query Wikidata and process items
    await this.query(this.options.url, this.options.sparql)
      .then(response => {
        // process each item
        response.results.bindings.forEach(item => {
          // inspect & rewrite item properties
          Object.keys(item).forEach(property => {
            // rewrite URI with the later download file reference
            if (item[property].type === "uri") {
              let uri = item[property].value;
              let filename = uri.substring(uri.lastIndexOf("/") + 1);
              filename = decodeURI(filename).replace(/%2C/g, ",");
              // TODO unique file name
              downloads.push({
                src: uri,
                dir: dir,
                filename: filename
              });
              // rewrite value with absolute local file path
              item[property].value = dir + filename;
            }
            // flatten objects by extracting values only
            item[property] = item[property].value;
          });
          // add collection
          collection.addNode(item);
        });
      })
      .catch(error => {
        console.log("Fetching Wikidata failed!", error);
      });
    return downloads;
  }

  async query(url, sparqlQuery) {
    const fullUrl = url + "?query=" + encodeURIComponent(sparqlQuery);
    let cfg = { headers: { Accept: "application/sparql-results+json" } };
    if (this.options.cacheEnabled) {
      cfg.cache = this.cache;
    }
    this.info("Fetching Wikidata ...");
    return got(fullUrl, cfg).json();
  }

  async download(downloads) {
    await Promise.all(
      downloads.map(download =>
        this.stream2File(
          download.src,
          download.dir,
          download.filename
        ).catch(error =>
          console.log(
            `Saving ${download.dir}${download.filename} failed: ${error}`
          )
        )
      )
    );
  }

  async stream2File(src, dir, filename) {
    var bar;
    let cfg = {};
    if (this.options.cacheEnabled) {
      cfg.cache = this.cache;
    }
    // ensure that directory exists
    fs.ensureDirSync(dir);
    // create write stream
    const path = dir + filename;
    const writer = fs.createWriteStream(path);
    // start request
    const response = await got
      .stream(src, cfg)
      .on("response", response => {
        // in verbose mode get content length to initialize progress bar
        if (this.options.verbose) {
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
        if (this.options.verbose && bar) {
          bar.update(progress.transferred);
        }
      });
    // pipe data stream to disk
    response.pipe(writer);
    return new Promise((resolve, reject) => {
      writer.on("finish", () => {
        resolve();
      });
      writer.on("error", err => {
        fs.unlink(path);
        reject(err);
      });
    });
  }
}

module.exports = WikidataSource;
