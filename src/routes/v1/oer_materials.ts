/**
 * ElasticSearch API
 * The API routes associated with retrieving and
 * manipuating data from Elastic Search.
 */

import { IConfiguration, IElasticsearchHit, ISearch, IQueryElement } from "../../Interfaces";


import { Router, Request, Response, NextFunction } from "express";
// validating the query parameters
import { query, param } from "express-validator";
// creation of the query string to help the user navigate through
import * as querystring from "querystring";
// add error handling functionality
import { ErrorHandler } from "../../library/error";
// import elasticsearch module
import Elasticsearch from "../../library/elasticsearch";
// import file mimetypes lists
import * as mimetypes from "../../config/mimetypes.json";

// initialize the express router
const router = Router();

// returns the general material type
function materialType(mimetype: string) {
    for (const type in mimetypes) {
        if (mimetypes[type].includes(mimetype)) {
            return type;
        }
    }
    return null;
}

// format the material
function materialFormat(hit: IElasticsearchHit, wikipedia?: boolean, wikipedia_limit?: number, getContent?: boolean, content_extension?: string) {
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
            domain: hit._source.provider_url
        },
        content_ids: hit._source.contents ? hit._source.contents.map((content) => content.content_id) : [],
        ... getContent && {
            contents: hit._source.contents.filter((content) => content.extension === content_extension)
        },
        ...wikipedia && {
            wikipedia: wikipedia_limit && wikipedia_limit > 0
                ? hit._source.wikipedia.slice(0, wikipedia_limit)
                : hit._source.wikipedia
        }
    };
}

// assign the elasticsearch API routes
export default (config: IConfiguration) => {
    // set the default parameters
    const DEFAULT_LIMIT = 20;
    const MAX_LIMIT = 100;
    const DEFAULT_PAGE = 1;
    // set the default disclaimer parameter
    const NO_LICENSE_DISCLAIMER = "X5GON recommends the use of the Creative Commons open licenses. During a transitory phase, other licenses, open in spirit, are sometimes used by our partner sites.";
    const DEFAULT_DISCLAIMER = "The usage of the corresponding material is in all cases under the sole responsibility of the user.";

    // esablish connection with elasticsearch
    const es = new Elasticsearch(config.elasticsearch);

    /**
     * @api {GET} /api/v1/oer_materials Search through the OER materials
     * @apiVersion 1.0.0
     * @apiName searchAPI
     * @apiGroup search
     */
    router.get("/oer_materials", [
        query("text").trim(),
        query("types").optional().trim()
            .customSanitizer((value: string) => (value && value.length ? value.toLowerCase() : null)),
        query("licenses").optional().trim()
            .customSanitizer((value: string) => (value && value.length ? value.toLowerCase().split(",") : null)),
        query("languages").optional().trim()
            .customSanitizer((value: string) => (value && value.length ? value.toLowerCase().split(",") : null)),
        query("content_languages").optional().trim()
            .customSanitizer((value: string) => (value && value.length ? value.toLowerCase().split(",") : null)),
        query("content_extension").optional().trim()
            .customSanitizer((value: string) => (value && value.length ? value.toLowerCase() : null)),
        query("provider_ids").optional().trim()
            .customSanitizer((value: string) => (value && value.length ? value.toLowerCase().split(",").map((id) => parseInt(id, 10)) : null)),
        query("wikipedia").optional().toBoolean(),
        query("wikipedia_limit").optional().toInt(),
        query("limit").optional().toInt(),
        query("page").optional().toInt()
    ], async (req: Request, res: Response, next: NextFunction) => {
        // extract the appropriate query parameters
        const requestQuery: ISearch = req.query;
        const {
            text,
            types,
            languages,
            content_languages,
            content_extension,
            provider_ids,
            licenses,
            wikipedia,
            wikipedia_limit,
            limit: queryLimit,
            page: queryPage
        } = requestQuery;

        if (!text) {
            return res.status(400).json({
                message: "query parameter 'text' not available",
                query: requestQuery
            });
        }

        // ------------------------------------
        // Set pagination parameters
        // ------------------------------------

        // set default pagination values
        // which part of the materials do we want to query
        const limit: number = !queryLimit
            ? DEFAULT_LIMIT
            : queryLimit <= 0
                ? DEFAULT_LIMIT
                : queryLimit >= MAX_LIMIT
                    ? DEFAULT_LIMIT
                    : queryLimit;

        const page: number = !queryPage
            ? DEFAULT_PAGE
            : queryPage;

        const size = limit;
        const from = (page - 1) * size;

        req.query.limit = limit;
        req.query.page = page;

        // ------------------------------------
        // Set query parameters
        // ------------------------------------

        // set the nested must conditions for the "contents" attribute
        const nestedContentsMust: IQueryElement[] = [];

        if (content_languages) {
            nestedContentsMust.push({
                terms: { "contents.language": content_languages }
            });
        }

        // get the content values
        let getContent: boolean;
        if (content_extension && ["plain", "webvtt", "dfxp"].includes(content_extension)) {
            getContent = true;
            nestedContentsMust.push({
                term: { "contents.extension": content_extension }
            });
        } else {
            nestedContentsMust.push({
                term: { "contents.extension": "plain" }
            });
        }

        // ------------------------------------
        // Set filter parameters
        // ------------------------------------

        // get the filter parameters (type and language)
        let typegroup: string;
        let filetypes: string;
        if (types && ["all", "text", "video", "audio"].includes(types)) {
            typegroup = types === "all" ? null : types;
        } else if (types && types.split(",").length > 0) {
            filetypes = types.split(",").map((t) => `.*\.${t.trim()}`).join("|");
        }

        // add the filter conditions for the regex
        const filters: IQueryElement[] = [];
        if (filetypes) {
            filters.push({
                regexp: { material_url: filetypes }
            });
        }
        // add the filter conditions for the term
        if (typegroup) {
            filters.push({
                term: { type: typegroup }
            });
        }
        if (licenses && licenses.length && !licenses.includes("cc")) {
            filters.push({
                terms: { "license.short_name": licenses }
            });
        }
        // add the filter conditions for multiple terms
        if (provider_ids) {
            filters.push({
                terms: { provider_id: provider_ids }
            });
        }
        if (languages) {
            filters.push({
                terms: { language: languages }
            });
        }

        // add the filter condition for existing fields
        if (licenses && licenses.length && licenses.includes("cc")) {
            filters.push({
                exists: { field: "license.url" }
            });
        }

        // check if we need to filter the documents
        const filterFlag = filters.length > 0;

        // ------------------------------------
        // Translate the user input
        // ------------------------------------

        const translation = text;

        // ------------------------------------
        // Set the elasticsearch query body
        // ------------------------------------

        // assign the elasticsearch query object
        const esQuery = {
            from, // set the from parameter from the "limit", "page" params
            size, // set the size parameter from the "limit", "page" params
            _source: {
                ...!getContent && {
                    excludes: [
                        "contents.type",
                        "contents.extension",
                        "contents.language",
                        "contents.value"
                    ]
                }
            },
            query: {
                bool: {
                    ...getContent && {
                        must: [{
                            nested: {
                                path: "contents",
                                query: {
                                    bool: {
                                        must: nestedContentsMust
                                    }
                                }
                            }
                        }]
                    },
                    should: [{
                        match: { title: text }
                    }, {
                        nested: {
                            path: "contents",
                            query: {
                                bool: {
                                    should: { match: { "contents.value": text } }
                                }
                            }
                        }
                    }, {
                        nested: {
                            path: "wikipedia",
                            query: {
                                bool: {
                                    must: [
                                        { match: { "wikipedia.sec_name": translation } }
                                    ]
                                }
                            }
                        }
                    }],
                    ...filterFlag && {
                        filter: filters
                    }
                }
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
            const results = await es.search("oer_materials", esQuery);
            // format the output before sending
            const output = results.hits.hits.map((hit: IElasticsearchHit) =>
                materialFormat(hit, wikipedia, wikipedia_limit, getContent, content_extension)
            );

            // prepare the parameters for the previous query
            const prevQuery = {
                ...req.query,
                ...page && { page: page - 1 }
            };

            // prepare the parameters for the next query
            const nextQuery = {
                ...req.query,
                ...page && { page: page + 1 }
            };

            const BASE_URL = "https://platform.x5gon.org/api/v1/search";
            // prepare the metadata used to navigate through the search
            const totalHits = results.hits.total.value;
            const totalPages = Math.ceil(results.hits.total.value / size);
            const prevPage = page - 1 > 0 ? `${BASE_URL}?${querystring.stringify(prevQuery)}` : null;
            const nextPage = totalPages >= page + 1 ? `${BASE_URL}?${querystring.stringify(nextQuery)}` : null;
            results.aggregations.providers.buckets.forEach((provider: { key: string }) => {
                provider.key = provider.key.toLowerCase();
            });

            // output the materials
            return res.json({
                query: req.query,
                rec_materials: output,
                metadata: {
                    total_hits: totalHits,
                    total_pages: totalPages,
                    prev_page: prevPage,
                    next_page: nextPage,
                    aggregations: {
                        licenses: results.aggregations.licenses.buckets,
                        languages: results.aggregations.languages.buckets,
                        providers: results.aggregations.providers.buckets,
                        types: results.aggregations.types.buckets
                    }
                }
            });
        } catch (error) {
            return next(new ErrorHandler(500, "Internal server error"));
        }
    });

    /**
     * @api {POST} /api/v1/oer_materials Add a new OER material to the elasticsearch index.
     * @apiVersion 1.0.0
     * @apiName esSearchAPI
     * @apiGroup search
     */
    router.post("/oer_materials", async (req: Request, res: Response, next: NextFunction) => {
        const {
            body: { record }
        } = req;

        try {
            record.title = record.title.replace(/\r*\n+/g, " ").replace(/\t+/g, " ").trim();
            if (record.description) {
                record.description = record.description.replace(/\r*\n+/g, " ").replace(/\t+/g, " ").trim();
            }
            record.extension = record.type;
            record.type = materialType(record.mimetype);

            // modify the license attribute when sending to elasticsearch
            const url = record.license;
            let shortName: string;
            let typedName: string[];
            const disclaimer = DEFAULT_DISCLAIMER;

            if (url) {
                const regex = /\/licen[sc]es\/([\w\-]+)\//;
                shortName = url.match(regex)[1];
                typedName = shortName.split("-");
            } else {
                shortName = NO_LICENSE_DISCLAIMER;
            }
            record.license = {
                short_name: shortName,
                typed_name: typedName,
                disclaimer,
                url
            };

            // modify the wikipedia array
            for (const value of record.wikipedia) {
                // rename the wikipedia concepts
                value.sec_uri = value.secUri;
                value.sec_name = value.secName;
                value.pagerank = value.pageRank;
                value.db_pedia_iri = value.dbPediaIri;
                value.support = value.supportLen;
                value.wiki_data_classes = value.wikiDataClasses;
                // delete the previous values
                delete value.secUri;
                delete value.secName;
                delete value.pageRank;
                delete value.dbPediaIri;
                delete value.supportLen;
                delete value.wikiDataClasses;
            }

            // get the record and push it to the elasticsearch index
            await es.pushRecord("oer_materials", record, record.material_id);
            // refresh the index after pushing the new record
            await es.refreshIndex("oer_materials");
            // return the material id of the added record
            return res.status(200).json({
                message: "record pushed to the index",
                material_id: record.material_id
            });
        } catch (error) {
            return next(new ErrorHandler(500, "Internal server error"));
        }
    });

    // get particular material
    router.get("/oer_materials/:material_id", [
        param("material_id").toInt(),
        query("wikipedia").optional().toBoolean(),
        query("wikipedia_limit").optional().toInt()
    ], async (req: Request, res: Response, next: NextFunction) => {
        const {
            params: {
                material_id: materialId
            },
            query: {
                wikipedia,
                wikipedia_limit
            }
        } = req;

        if (!materialId) {
            return res.status(400).json({
                message: "body parameter material_id not an integer",
                params: req.params,
                query: req.query
            });
        }

        try {
            const results = await es.search("oer_materials", {
                query: { terms: { _id: [materialId] } }
            });
            // format the output before sending
            const output = results.hits.hits.map((hit: IElasticsearchHit) =>
                materialFormat(hit, wikipedia, wikipedia_limit)
            )[0];

            // return the status as the response
            return res.status(200).json({
                rec_materials: output
            });
        } catch (error) {
            return next(new ErrorHandler(500, "Internal server error"));
        }
    });

    /**
     * @api {PATCH} /api/v1/oer_materials Update the OER material in the elasticsearch index.
     * @apiVersion 1.0.0
     * @apiName esSearchAPI
     * @apiGroup search
     */
    router.patch("/oer_materials/:material_id", [
        param("material_id").toInt()
    ], async (req: Request, res: Response, next: NextFunction) => {
        const {
            params: { material_id },
            body: { record }
        } = req;

        if (!material_id) {
            return res.status(400).json({
                message: "body parameter material_id not an integer",
                query: { material_id }
            });
        }

        try {
            // modify the wikipedia array
            for (const value of record.wikipedia) {
                // rename the wikipedia concepts
                value.sec_uri = value.secUri;
                value.sec_name = value.secName;
                value.pagerank = value.pageRank;
                value.db_pedia_iri = value.dbPediaIri;
                value.support = value.supportLen;
                value.wiki_data_classes = value.wikiDataClasses;
                // delete the previous values
                delete value.secUri;
                delete value.secName;
                delete value.pageRank;
                delete value.dbPediaIri;
                delete value.supportLen;
                delete value.wikiDataClasses;
            }

            // update the record in the elasticsearch index
            await es.updateRecord("oer_materials", material_id, record);
            // refresh the elasticsearch index
            await es.refreshIndex("oer_materials");
            // return the status as the response
            return res.status(200).json({ message: "record updated in the index" });
        } catch (error) {
            return next(new ErrorHandler(500, "Internal server error"));
        }
    });

    /**
     * @api {DELETE} /api/v1/oer_materials DELETE the OER material from the elasticsearch index.
     * @apiVersion 1.0.0
     * @apiName esSearchAPI
     * @apiGroup search
     */
    router.delete("/oer_materials/:material_id", [
        param("material_id").toInt()
    ], async (req: Request, res: Response, next: NextFunction) => {
        const {
            params: { material_id }
        } = req;

        try {
            // delete all results that match the material_id
            await es.deleteRecord("oer_materials", material_id);
            // refresh the elasticsearch index
            await es.refreshIndex("oer_materials");
            // return the status as the response
            return res.status(200).json({ message: "record deleted in the index" });
        } catch (error) {
            return next(new ErrorHandler(500, "Internal server error"));
        }
    });

    // return the router
    return router;
};
