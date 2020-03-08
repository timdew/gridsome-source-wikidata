const got = require("got");
const fs = require("fs-extra");
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

class WikidataSource {
  constructor(api, options) {
    this.options = options;

    // verify config params

    if (this.options.verbose === "true") {
      this.options.verbose = true;
    } else {
      this.options.verbose = false;
    }

    if (!this.options.url) {
      throw new Error(
        `Missing url endpoint. Please provide a valid url endpoint.`
      );
    }

    if (!this.options.sparql) {
      throw new Error(
        `Missing sparql query. Please provide a valid sparql query.`
      );
    }

    if (!this.options.baseDir) {
      this.options.baseDir = "/content/media/";
      this.warn(`No baseDir provided. Using ${this.options.baseDir} instead.`);
    }

    // start processing

    api.onCreateNode(options => {
      this.info(options);
    });

    api.loadSource(async actions => {
      // fetch data ...
      const downloads = await this.fetchWikidata(actions);
      // download remote URIs ...
      if (process.env.DOWNLOAD_MEDIA === "true") {
        this.info("Starting media download(s) ...");
        await this.download(downloads);
      }
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
    this.info("Fetching Wikidata ...");
    const queryDispatcher = new SPARQLQueryDispatcher(this.options.url);
    const collection = actions.addCollection({ typeName: "Record" });
    const downloads = [];
    const dir = process.cwd() + this.options.baseDir;
    // query Wikidata and process items
    await queryDispatcher
      .query(this.options.sparql)
      .then(response => {

        this.info(response);

        // parse JSON body
        let body = JSON.parse(response.body);
        // process each item
        body.results.bindings.forEach(item => {
          // inspect & rewrite item properties
          Object.keys(item).forEach(property => {
            // rewrite URI with the later download file reference
            if (item[property].type === "uri") {
              let uri = item[property].value;
              let filename = uri.substring(uri.lastIndexOf("/") + 1);
              filename = decodeURI(filename).replace(/%2C/g, ",");
              // TODO file name
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
    // ensure that directory exists
    fs.ensureDirSync(dir);
    // create write stream
    const path = dir + filename;
    const writer = fs.createWriteStream(path);
    // start request
    const response = await got
      .stream(src)
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

class SPARQLQueryDispatcher {
  constructor(url) {
    this.url = url;
  }

  async query(sparqlQuery) {
    const fullUrl = this.url + "?query=" + encodeURIComponent(sparqlQuery);
    return await got(fullUrl, {
      headers: { Accept: "application/sparql-results+json" }
    });
  }
}

module.exports = WikidataSource;
