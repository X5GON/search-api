/**
 * ElasticSearch API
 * The API routes associated with retrieving and
 * manipuating data from Elastic Search.
 */

const router = require("express").Router();
const ElasticSearch = require("../../library/elasticsearch");
const { ErrorHandler } = require("../../library/error");

// internal modules
const mimetypes = require("../../config/mimetypes");

// validating the query parameters
const { query, body, param } = require("express-validator");

// creation of the query string to help the user navigate through
const querystring = require("querystring");

/**
 * Returns the general material type.
 * @param {String} mimetype - The document mimetype.
 * @returns {String|Null} The material type.
 */
function materialType(mimetype) {
    for (let type in mimetypes) {
        if (mimetypes[type].includes(mimetype)) {
            return type;
        }
    }
    return null;
}

function materialFormat(hit, { wikipedia, wikipedia_limit }) {
    return {
        weight: hit._score,
        material_id: hit._source.material_id,
        title: hit._source.title,
        description: hit._source.description,
        creation_date: hit._source.creation_date,
        retrieved_date: hit._source.retrieved_date,
        type: hit._source.type,
        mimetype: hit._source.mimetype,
        url: hit._source.material_url,
        website: hit._source.website_url,
        language: hit._source.language,
        license: hit._source.license,
        provider: {
            id: hit._source.provider_id,
            name: hit._source.provider_name.toLowerCase(),
            domain: hit._source.provider_url,
        },
        content_ids: hit._source.contents ? hit._source.contents.map((content) => content.content_id) : [],
        ...wikipedia && {
            wikipedia: wikipedia_limit && wikipedia_limit > 0
                ? hit._source.wikipedia.slice(0, wikipedia_limit)
                : hit._source.wikipedia
        }
    };
}


/**
 * @description Assign the elasticsearch API routes.
 * @param {Object} config - The configuration object.
 * @returns {Object} The search router.
 */
module.exports = (config) => {
    // set the default parameters
    const DEFAULT_LIMIT = 20;
    const MAX_LIMIT = 100;
    const DEFAULT_PAGE = 1;


    // esablish connection with elasticsearch
    const es = new ElasticSearch(config.elasticsearch);

    let setLanguages = [];
    es.search("oer_materials", {
        size: 0,
        aggregations: {
            languages: {
                terms: { field: "language" }
            },
        }
    }).then(({ aggregations }) => {
        setLanguages = aggregations.languages.buckets
            .map((obj) => obj.key);
    });


    /**
     * @api {GET} /api/v1/oer_materials Search through the OER materials
     * @apiVersion 1.0.0
     * @apiName searchAPI
     * @apiGroup search
     */
    router.get("/recommend/materials", [
        query("text").trim(),
        query("url").trim(),
        query("types").optional().trim()
            .customSanitizer((value) => (value && value.length ? value.toLowerCase() : null)),
        query("licenses").optional().trim()
            .customSanitizer((value) => (value && value.length ? value.toLowerCase().split(",") : null)),
        query("languages").optional().trim()
            .customSanitizer((value) => (value && value.length ? value.toLowerCase().split(",") : null)),
        query("content_languages").optional().trim()
            .customSanitizer((value) => (value && value.length ? value.toLowerCase().split(",") : null)),
        query("provider_ids").optional().trim()
            .customSanitizer((value) => (value && value.length ? value.toLowerCase().split(",").map((value) => parseInt(value)) : null)),
        query("wikipedia").optional().toBoolean(),
        query("wikipedia_limit").optional().toInt(),
        query("limit").optional().toInt(),
        query("page").optional().toInt(),
    ], async (req, res, next) => {
        // extract the appropriate query parameters
        let {
            query: {
                text,
                url,
                types,
                languages,
                content_languages,
                provider_ids,
                licenses,
                wikipedia,
                wikipedia_limit,
                limit,
                page,
            }
        } = req;

        if (!text && !url) {
            return res.status(400).json({
                message: "query parameter 'text' or 'url' not available",
                query: req.query
            });
        }

        // ------------------------------------
        // First check if material is present
        // ------------------------------------

        const materialQuery = {
            size: 100,
            query: {
                term: { website_url: { value: url } }
            }
        };

        let wikiConcepts;
        let materialURLs;
        let preferedLangs;
        try {
            // get the search results from elasticsearch
            const results = await es.search("oer_materials", materialQuery);
            if (results.hits.total.value === 0 && text) {
                const queryParams = querystring.stringify(req.query);
                return res.redirect(`/api/v1/oer_materials?${queryParams}`);
            }

            const viewedMaterials = results.hits.hits;
            const viewedLangauges = viewedMaterials.map((hit) => hit._source.language);
            materialURLs = viewedMaterials.map((hit) => hit._source.material_url);
            preferedLangs = setLanguages.filter((lang) => !viewedLangauges.includes(lang));
            // return res.json(materialURLs);
            wikiConcepts = viewedMaterials
                .map((hit) => hit._source.wikipedia.slice(0, 30).map((wiki) => wiki.sec_name))
                .reduce((prev, curr) => prev.concat(curr), [])
                .reduce((prev, curr) => {
                    if (!prev[curr]) {
                        prev[curr] = 1;
                    }
                    prev[curr] += 1;
                    return prev;
                }, {});

            const startSlice = wikiConcepts.length > 2 ? 2 : 0;
            wikiConcepts = Object.entries(wikiConcepts).sort((a, b) => b[1] - a[1])
                .slice(startSlice, 20);

        } catch (error) {
            return next(new ErrorHandler(500, "Internal server error"));
        }

        // ------------------------------------
        // Set pagination parameters
        // ------------------------------------

        // set default pagination values
        if (!limit) {
            limit = DEFAULT_LIMIT;
        } else if (limit <= 0) {
            limit = DEFAULT_LIMIT;
        } else if (limit >= MAX_LIMIT) {
            limit = MAX_LIMIT;
        }
        req.query.limit = limit;
        if (!page) {
            page = DEFAULT_PAGE;
            req.query.page = page;
        }

        // ------------------------------------
        // Set query parameters
        // ------------------------------------

        // set the nested must conditions for the "contents" attribute
        const nestedContentsMust = [{
            term: { "contents.extension": "plain" }
        }];
        if (content_languages) {
            nestedContentsMust.push({
                terms: { "contents.language": content_languages }
            });
        }

        // ------------------------------------
        // Set filter parameters
        // ------------------------------------

        // get the filter parameters (type and language)
        let typegroup;
        let filetypes;
        if (types && ["all", "text", "video", "audio"].includes(types)) {
            typegroup = types === "all" ? null : types;
        } else if (types && types.split(",").length > 0) {
            filetypes = types.split(",").map((t) => `.*\.${t.trim()}`).join("|");
        }

        //  add the must not filter conditions
        const filtersMustNot = [];
        if (materialURLs) {
            filtersMustNot.push({
                terms: { material_url: materialURLs }
            })
        }

        // add the filter conditions for the regex
        const filtersMust = [];
        if (filetypes) {
            filtersMust.push({
                regexp: { material_url: filetypes }
            });
        }
        // add the filter conditions for the term
        if (typegroup) {
            filtersMust.push({
                term: { type: typegroup }
            });
        }
        if (licenses && licenses.length && !licenses.includes("cc")) {
            filtersMust.push({
                terms: { "license.short_name": licenses }
            });
        }
        // add the filter conditions for multiple terms
        if (provider_ids) {
            filtersMust.push({
                terms: { provider_id: provider_ids }
            });
        }
        if (languages) {
            filtersMust.push({
                terms: { language: languages }
            });
        }

        // add the filter condition for existing fields
        if (licenses && licenses.length && licenses.includes("cc")) {
            filtersMust.push({
                exists: { field: "license.url" }
            });
        }

        // check if we need to filter the documents
        const filterFlag = filtersMust.length || filtersMustNot.length;

        // which part of the materials do we want to query
        const size = limit;
        const from = (page - 1) * size;

        // ------------------------------------
        // Set the elasticsearch query body
        // ------------------------------------

        // assign the elasticsearch query object
        const body = {
            from, // set the from parameter from the "limit", "page" params
            size, // set the size parameter from the "limit", "page" params
            _source: {
                excludes: [
                    "contents.type",
                    "contents.extension",
                    "contents.language",
                    "contents.value"
                ]
            },
            query: {
                bool: {
                    should: wikiConcepts.map((wiki) => ({
                        nested: {
                            path: "wikipedia",
                            query: {
                                match: {
                                    "wikipedia.sec_name": {
                                        query: wiki[0],
                                        boost: wiki[1] / materialURLs.length
                                    }
                                },
                            }
                        }
                    })),
                    ...filterFlag && {
                        filter: {
                            bool: {
                                ...filtersMust && { must: filtersMust },
                                ...filtersMustNot && { must_not: filtersMustNot }
                            }
                        }
                    }
                }
            },
            collapse: {
                field: "website_url"
            },
            aggs: {
                languages: {
                    terms: { field: "language" }
                },
                types: {
                    terms: { field: "type" }
                },
                licenses: {
                    terms: { field: "license.short_name" }
                },
                providers: {
                    terms: { field: "provider_name" }
                }
            },
            min_score: 5,
            track_total_hits: true
        };

        try {
            // get the search results from elasticsearch
            const results = await es.search("oer_materials", body);
            // return res.json(results);
            // format the output before sending
            const output = results.hits.hits.map((hit) => materialFormat(hit, { wikipedia, wikipedia_limit }));

            // prepare the parameters for the previous query
            const prevQuery = {
                ...req.query,
                ...page && { page: page - 1 },
            };

            // prepare the parameters for the next query
            const nextQuery = {
                ...req.query,
                ...page && { page: page + 1 },
            };

            const BASE_URL = "https://platform.x5gon.org/api/v1/recommend/materials";
            // prepare the metadata used to navigate through the search
            const total_hits = results.hits.total.value;
            const total_pages = Math.ceil(results.hits.total.value / size);
            const prev_page = page - 1 > 0 ? `${BASE_URL}?${querystring.stringify(prevQuery)}` : null;
            const next_page = total_pages >= page + 1 ? `${BASE_URL}?${querystring.stringify(nextQuery)}` : null;
            results.aggregations.providers.buckets.forEach((provider) => {
                provider.key = provider.key.toLowerCase();
            });

            // output the materials
            return res.json({
                query: req.query,
                rec_materials: output,
                metadata: {
                    total_hits,
                    total_pages,
                    prev_page,
                    next_page,
                    aggregations: {
                        licenses: results.aggregations.licenses.buckets,
                        types: results.aggregations.types.buckets,
                        languages: results.aggregations.languages.buckets,
                        providers: results.aggregations.providers.buckets
                    }
                }
            });
        } catch (error) {
            return next(new ErrorHandler(500, "Internal server error"));
        }
    });

    // return the router
    return router;
};
