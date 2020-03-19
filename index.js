const HttpProxy = require("./httpProxy.js");

class WikidataSource {
  constructor(api, options) {
    // combine options with defaults
    this._options = exports.defaults;
    this._options = Object.assign({}, this._options, options);

    // verify mandatory args

    if (!this._options.url) {
      throw new Error(
        `Missing 'url' endpoint. Please provide a valid url endpoint.`
      );
    }

    if (!this._options.sparql) {
      throw new Error(
        `Missing 'sparql' query. Please provide a valid sparql query.`
      );
    }

    if (!this._options.typeName) {
      throw new Error(
        `Missing 'typeName' label. Please provide a type name label.`
      );
    }

    // init HttpProxy
    this._proxy = new HttpProxy({
      baseDir: this._options.baseDir,
      cacheFile: this._options.cacheFile,
      cacheEnabled: this._options.cacheEnabled,
      ttl: this._options.ttl,
      verbose: this._options.verbose
    });

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
        await this._proxy.download(downloads);
      }
    });
  }

  async fetchWikidata(actions) {
    const collection = actions.addCollection({
      typeName: this._options.typeName
    });
    const downloads = [];
    const fileDir = process.cwd() + this._options.baseDir;
    const url =
      this._options.url + "?query=" + encodeURIComponent(this._options.sparql);
    // fetch Wikidata and process items
    this.info("Fetching Wikidata ...");
    await this._proxy
      .fetchJson(url)
      .then(response => {
        // process each item
        response.results.bindings.forEach(item => {
          // inspect & rewrite item properties
          Object.keys(item).forEach(property => {
            // rewrite URI with the later download file reference
            if (item[property].type === "uri") {
              const uri = item[property].value;
              let filename = uri.substring(uri.lastIndexOf("/") + 1);
              filename = decodeURI(filename).replace(/%2C/g, ",");
              // TODO file name
              downloads.push({
                uri: uri,
                fileDir: fileDir,
                filename: filename
              });
              // rewrite value with absolute local file path
              item[property].value = fileDir + filename;
            }
            // flatten objects by extracting values only
            item[property] = item[property].value;
          });
          // add collection
          collection.addNode(item);
        });
      })
      .catch(error => {
        console.error("Fetching Wikidata failed!", error);
      });
    return downloads;
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
  verbose: false
};

module.exports = WikidataSource;
