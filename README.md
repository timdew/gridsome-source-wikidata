# gridsome-source-wikidata

## Install
* yarn add gridsome-source-wikidata
* npm install gridsome-source-wikidata

## Usage

```
module.exports = {
  plugins: [
    {
      use: "gridsome-source-wikidata",
      options: {
        url: "https://query.wikidata.org/sparql",
        sparql: `SELECT DISTINCT ?item ?paintingLabel (MIN(?images) AS ?image) WHERE {
          ?painting (wdt:P31/(wdt:P279*)) wd:Q3305213;
            wdt:P170 wd:Q762;
            wdt:P18 ?images;
          BIND(REPLACE(STR(?painting), "^.*/", "") AS ?item)
          SERVICE wikibase:label {
            bd:serviceParam wikibase:language "[AUTO_LANGUAGE],en".
            ?painting rdfs:label ?paintingLabel.
          }
        }
        GROUP BY ?item ?painting ?paintingLabel ?image
        LIMIT 10`,
        typeName: "Painting",
        baseDir: "/content/images/",
        verbose: "true"
      }
    },
  templates: {
    Painting: "/:item"
  }
}
```

Query SPARQL in [Wikidata Query Service](https://query.wikidata.org/#SELECT%20DISTINCT%20%3Fitem%20%3FpaintingLabel%20%28MIN%28%3Fimages%29%20AS%20%3Fimage%29%20WHERE%20%7B%0A%20%20%3Fpainting%20%28wdt%3AP31%2F%28wdt%3AP279%2a%29%29%20wd%3AQ3305213%3B%0A%20%20%20%20wdt%3AP170%20wd%3AQ762%3B%0A%20%20%20%20wdt%3AP18%20%3Fimages%3B%0A%20%20BIND%28REPLACE%28STR%28%3Fpainting%29%2C%20%22%5E.%2a%2F%22%2C%20%22%22%29%20AS%20%3Fitem%29%0A%20%20SERVICE%20wikibase%3Alabel%20%7B%0A%20%20%20%20bd%3AserviceParam%20wikibase%3Alanguage%20%22%5BAUTO_LANGUAGE%5D%2Cen%22.%0A%20%20%20%20%3Fpainting%20rdfs%3Alabel%20%3FpaintingLabel.%0A%20%20%7D%0A%7D%0AGROUP%20BY%20%3Fitem%20%3Fpainting%20%3FpaintingLabel%20%3Fimage%0ALIMIT%2010)

**Property** | **Description** | **Mandatory**
--- | --- | ---
url | `https://query.wikidata.org/sparql` | true
sparql | SPARQL [examples](https://www.wikidata.org/wiki/Wikidata:SPARQL_query_service/queries/examples) | true
typeName | Specify [template](https://gridsome.org/docs/templates/) correlation | true
baseDir | download folder | false; default: `/content/images/`
verbose | set verbose mode | false

## Open issues

* download URIs based on an automatic file verification
* add fine grained filters for URI downloads 
* current version affected by a bug in [Node.js ≥ 13.10.0](https://github.com/sindresorhus/got/issues/1107)

