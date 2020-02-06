/**
 * ElasticSearch API
 * The API routes associated with retrieving and
 * manipuating data from Elastic Search.
 */

const router = require("express").Router();
const ElasticSearch = require("../../library/elasticsearch");
const { ErrorHandler } = require("../../library/error");

// validating the query parameters
const { query, body } = require("express-validator");

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
        query("licenses").optional().trim()
            .customSanitizer((value) => (value && value.length ? value.toLowerCase().split(",") : null)),
        query("languages").optional().trim()
            .customSanitizer((value) => (value && value.length ? value.toLowerCase().split(",") : null)),
        query("languages_content").optional().trim()
            .customSanitizer((value) => (value && value.length ? value.toLowerCase().split(",") : null)),
        query("provider_ids").optional().trim()
            .customSanitizer((value) => (value && value.length ? value.toLowerCase().split(",").map((value) => parseInt(value)) : null)),
        query("wikipedia").optional().toBoolean(),
        query("wikipedia_limit").optional().toInt(),
        query("limit").optional().toInt(),
        query("page").optional().toInt(),
    ], async (req, res) => {
        // extract the appropriate query parameters
        let {
            query: {
                text,
                type,
                languages,
                languages_content,
                provider_ids,
                licenses,
                wikipedia,
                wikipedia_limit,
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
            term: {
                "contents.extension": "plain"
            }
        }];
        if (languages_content) {
            nestedContentsMust.push({
                terms: { "contents.language": languages_content }
            });
        }

        // ------------------------------------
        // Set filter parameters
        // ------------------------------------

        // get the filter parameters (type and language)
        let typegroup;
        let filetypes;
        if (type && ["all", "text", "video", "audio"].includes(type)) {
            typegroup = type === "all" ? null : type;
        } else if (type && type.split(",").length > 0) {
            filetypes = type.split(",").map((t) => `.*\.${t.trim()}`).join("|");
        }

        // add the filter conditions for the regex
        const filterMustRegexp = [];
        if (filetypes) {
            filterMustRegexp.push({
                regexp: { material_url: filetypes }
            });
        }
        // add the filter conditions for the term
        const filterMustTerm = [];
        if (typegroup) {
            filterMustTerm.push({
                term: { type: typegroup }
            });
        }
        if (licenses && licenses.length && !licenses.includes("cc")) {
            filterMustTerm.push({
                terms: { "license.short_name": licenses }
            });
        }
        // add the filter conditions for multiple terms
        const filterMustTerms = [];
        if (provider_ids) {
            filterMustTerms.push({
                terms: { provider_id: provider_ids }
            });
        }
        if (languages) {
            filterMustTerms.push({
                terms: { language: languages }
            });
        }

        // add the filter condition for existing fields
        const filterMustExist = [];
        if (licenses && licenses.length && licenses.includes("cc")) {
            filterMustExist.push({
                exists: { field: "license.url" }
            });
        }

        // check if we need to filter the documents
        const filterFlag = filterMustRegexp.length
            || filterMustTerm.length
            || filterMustTerms.length
            || filterMustExist.length;

        // which part of the materials do we want to query
        const size = limit;
        const from = (page - 1) * size;


        // ------------------------------------
        // Set the elasticsearch query body
        // ------------------------------------

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
                                    must: nestedContentsMust
                                }
                            }
                        }
                    }],
                    ...filterFlag && {
                        filter: {
                            bool: {
                                ...filterMustRegexp.length && { must: filterMustRegexp },
                                ...filterMustTerm.length && { must: filterMustTerm },
                                ...filterMustTerms.length && { must: filterMustTerms },
                                ...filterMustExist.length && { must: filterMustExist }
                            }
                        }
                    }
                }
            },
            min_score: 5,
        };

        try {
            // get the search results from elasticsearch
            const results = await es.search("oer_materials", body);
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
                content_ids: hit._source.contents.map((content) => content.content_id),
                ...wikipedia && {
                    wikipedia: wikipedia_limit && wikipedia_limit > 0
                        ? hit._source.wikipedia.slice(0, wikipedia_limit)
                        : hit._source.wikipedia
                }
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
            throw new ErrorHandler(500, "Internal server error");
        }
    });

    /**
     * @api {POST} /api/v1/oer_materials Add a new OER material to the elasticsearch index.
     * @apiVersion 1.0.0
     * @apiName esSearchAPI
     * @apiGroup search
     */
    router.post("/oer_materials", async (req, res) => {
        const {
            body: { record }
        } = req;

        try {
            // get the record and push it to the elasticsearch index
            await es.pushRecord("oer_materials", record);
            // refresh the index after pushing the new record
            await es.refreshIndex("oer_materials");
            // return the material id of the added record
            return res.status(200).json({ message: "record pushed to the index" });
        } catch (error) {
            throw new ErrorHandler(500, "Internal server error");
        }
    });

    /**
     * @api {PATCH} /api/v1/oer_materials Update the OER material in the elasticsearch index.
     * @apiVersion 1.0.0
     * @apiName esSearchAPI
     * @apiGroup search
     */
    router.patch("/oer_materials", [
        body("material_id").toInt(),
    ], async (req, res) => {
        const {
            body: {
                material_id,
                record
            }
        } = req;

        if (!material_id) {
            return res.status(400).json({
                message: "body parameter material_id not an integer",
                query: { material_id }
            });
        }

        // get the elasticsearch id of the document
        const get_document_id_query = {
            query: {
                bool: {
                    must: [{ match: { material_id } }]
                }
            }
        };

        // get the search results from elasticsearch
        const results = await es.search("oer_materials", get_document_id_query);
        // get the elasticsearch document id
        if (results.hits.hits.length !== 1) {
            // no document with given material_id found in elasticsearch
            return res.status(400).json({
                message: "record with material_id not in elasticsearch"
            });
        }

        try {
            // get the elasticsearch document id
            const documentId = results.hits.hits[0]._id;
            // update the record in the elasticsearch index
            await es.updateRecord("oer_materials", documentId, record);
            // refresh the elasticsearch index
            await es.refreshIndex("oer_materials");
            // return the status as the response
            return res.status(200).json({ message: "record updated in the index" });
        } catch (error) {
            throw new ErrorHandler(500, "Internal server error");
        }
    });

    /**
     * @api {DELETE} /api/v1/oer_materials DELETE the OER material from the elasticsearch index.
     * @apiVersion 1.0.0
     * @apiName esSearchAPI
     * @apiGroup search
     */
    router.delete("/oer_materials", [
        query("material_id").toInt()
    ], async (req, res) => {
        const {
            query: { material_id }
        } = req;


        if (!material_id) {
            return res.status(400).json({
                message: "query parameter material_id not an integer",
                query: { material_id }
            });
        }

        // get the elasticsearch id of the document
        const get_document_id_query = {
            query: {
                bool: {
                    must: [{ match: { material_id } }]
                }
            }
        };

        // get the search results from elasticsearch
        const results = await es.search("oer_materials", get_document_id_query);
        try {
            // delete all results that match the material_id
            const deleteRecords = [];
            for (let record of results.hits.hits) {
                deleteRecords.push(es.deleteRecord("oer_materials", record._id));
            }
            await Promise.all(deleteRecords);
            // refresh the elasticsearch index
            await es.refreshIndex("oer_materials");
            // return the status as the response
            return res.status(200).json({ message: "record deleted in the index" });
        } catch (error) {
            throw new ErrorHandler(500, "Internal server error");
        }
    });


    // return the router
    return router;
};
