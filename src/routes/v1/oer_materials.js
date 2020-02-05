/**
 * ElasticSearch API
 * The API routes associated with retrieving and
 * manipuating data from Elastic Search.
 */

const router = require("express").Router();
const ElasticSearch = require("../../library/elasticsearch");
const { ErrorHandler } = require("../../library/error");

// validating the query parameters
const { query } = require("express-validator");

// creation of the query string to help the user navigate through
const querystring = require("querystring");

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


    /**
     * @api {GET} /api/v1/oer_materials Search through the OER materials
     * @apiVersion 1.0.0
     * @apiName searchAPI
     * @apiGroup search
     */
    router.get("/oer_materials", [
        query("text").trim(),
        query("type").optional().trim()
            .customSanitizer((value) => (value && value.length ? value.toLowerCase() : null)),
        query("license").optional().trim()
            .customSanitizer((value) => (value && value.length ? value.toLowerCase() : null)),
        query("languages").optional().trim()
            .customSanitizer((value) => (value && value.length ? value.toLowerCase().split(",") : null)),
        query("provider_id").optional().toInt(),
        query("limit").optional().toInt(),
        query("page").optional().toInt(),
    ], async (req, res) => {
        // extract the appropriate query parameters
        let {
            query: {
                text,
                type,
                languages,
                provider_id,
                license,
                limit,
                page,
            }
        } = req;

        if (!text) {
            // return the error message of the missing parameter
            return res.json({
                error: { message: "Missing parameter 'text'" },
                query: { ...req.query }
            });
        }

        // get the filter parameters (type and language)
        let typegroup;
        let filetypes;
        if (type && ["all", "text", "video", "audio"].includes(type)) {
            typegroup = type === "all" ? null : type;
        } else if (type && type.split(",").length > 0) {
            filetypes = type.split(",").map((t) => `.*\.${t.trim()}`).join("|");
        }

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

        // add the must filter values
        const mustConditions = [];
        if (provider_id) {
            mustConditions.push({
                match: { provider_id }
            });
        }
        if (filetypes) {
            mustConditions.push({
                regexp: { material_url: filetypes }
            });
        }

        // check if we need to filter the documents
        const filterFlag = languages || typegroup || license;
        const filterMustTerms = [];
        if (typegroup) {
            filterMustTerms.push({
                term: {
                    type: typegroup
                }
            });
        }
        if (license) {
            filterMustTerms.push({
                term: {
                    "license.short_name": license
                }
            });
        }
        // which part of the materials do we want to query
        const size = limit;
        const from = (page - 1) * size;
        // assign the appropriate index
        const index = "oer_materials";
        // assign the elasticsearch query object
        const body = {
            from, // set the from parameter from the "limit", "offset", "page" params
            size, // set the size parameter from the "limit", "offset", "page" params
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
                    should: [{
                        match: { title: text }
                    }, {
                        nested: {
                            path: "contents",
                            query: {
                                bool: {
                                    should: { match: { "contents.value": text } },
                                    must: { term: { "contents.extension": "plain" } }
                                }
                            }
                        }
                    }],
                    ...mustConditions.length && {
                        must: mustConditions
                    },
                    ...filterFlag && {
                        filter: {
                            bool: {
                                ...filterMustTerms.length && { must: filterMustTerms },
                                ...languages && { must: { terms: { language: languages } } },
                            }
                        }
                    }
                }
            },
            min_score: 5,
        };

        try {
            // get the search results from elasticsearch
            const results = await es.search(index, body);
            // format the output before sending
            const output = results.hits.hits.map((hit) => ({
                weight: hit._score,
                material_id: hit._source.material_id,
                title: hit._source.title,
                description: hit._source.description,
                creation_date: hit._source.creation_date,
                retrieved_date: hit._source.retrieved_date,
                type: hit._source.type,
                mimetype: hit._source.mimetype,
                material_url: hit._source.material_url,
                website_url: hit._source.website_url,
                language: hit._source.language,
                license: hit._source.license,
                provider: {
                    id: hit._source.provider_id,
                    name: hit._source.provider_name,
                    domain: hit._source.provider_url,
                },
                content_ids: hit._source.contents.map((content) => content.content_id)
            }));

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

            const BASE_URL = "https://platform.x5gon.org/api/v1/oer_materials";
            // prepare the metadata used to navigate through the search
            const total_hits = results.hits.total.value;
            const total_pages = Math.ceil(results.hits.total.value / size);
            const prev_page = page - 1 > 0 ? `${BASE_URL}?${querystring.stringify(prevQuery)}` : null;
            const next_page = total_pages >= page + 1 ? `${BASE_URL}?${querystring.stringify(nextQuery)}` : null;
            // output the materials
            return res.json({
                query: req.query,
                oer_materials: output,
                metadata: {
                    total_hits,
                    total_pages,
                    prev_page,
                    next_page
                }
            });
        } catch (error) {
            console.log(error);
            throw new ErrorHandler(500, "Internal server error");
        }
    });

    /**
     * @api {POST} /api/v1/oer_materials Add a new OER material to the elasticsearch index.
     * @apiVersion 1.0.0
     * @apiName esSearchAPI
     * @apiGroup search
     */
    // TODO: define the route
    router.post("/oer_materials", (req, res) => {
        throw new ErrorHandler(404, "Route not found");
    });

    /**
     * @api {PUT} /api/v1/oer_materials Update the OER material in the elasticsearch index.
     * @apiVersion 1.0.0
     * @apiName esSearchAPI
     * @apiGroup search
     */
    // TODO: define the route
    router.put("/oer_materials", (req, res) => {
        throw new ErrorHandler(404, "Route not found");
    });

    /**
     * @api {DELETE} /api/v1/oer_materials DELETE the OER material from the elasticsearch index.
     * @apiVersion 1.0.0
     * @apiName esSearchAPI
     * @apiGroup search
     */
    // TODO: define the route
    router.delete("/oer_materials", (req, res) => {
        throw new ErrorHandler(404, "Route not found");
    });


    // return the router
    return router;
};
