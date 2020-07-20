/**
 * ElasticSearch API
 * The API routes associated with retrieving and
 * manipuating data from Elastic Search.
 */

import { IConfiguration, IElasticsearchHit, ISearch, IQueryElement, IQueryImage } from "../../Interfaces";


import { Router, Request, Response, NextFunction } from "express";
// validating the query parameters
import { query, param } from "express-validator";
// creation of the query string to help the user navigate through
import * as querystring from "querystring";
// add error handling functionality
import { ErrorHandler } from "../../library/error";
// import elasticsearch module
import Elasticsearch from "../../library/elasticsearch";
// import bent for making requests
import * as bent from "bent";
// import file mimetypes lists
import * as mimetypes from "../../config/mimetypes.json";
// conversion of language iso codes
const ISO6391 = require("iso-639-1");

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
        language_full: ISO6391.getName(hit._source.language),
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

    const BASE_URL = "https://platform.x5gon.org/api/v2/search";
    // establish connection with elasticsearch
    const es = new Elasticsearch(config.elasticsearch);

    // prepare API request to retrieve image metadata from Creative Commons Search
    const ccSearch = bent("GET", "https://api.creativecommons.engineering", "json", 200, { "Authorization": `bearer ${config.creativecommons.token}` });

    // get the images from creative commons search
    async function fetchImages(text: string, limit: number, page: number, licenses: string[]) {
        // first filter out the licenses
        const filteredLicenses = licenses ? licenses.filter((l) => l !== 'cc') : licenses;
        // prepare query for CC search
        const queryObject = {
            q: text,
            ...filteredLicenses && { license: filteredLicenses.join(",") },
            source: config.creativecommons.source.join(","),
            page_size: limit,
            page
        };
        const queryString = querystring.stringify(queryObject);
        // make request to ccSearch
        const response = await ccSearch(`/v1/images?${queryString}`);
        // return the formatted response
        return response;
    }

    // formats the license
    function formatLicense(license: string, license_url: string) {
        // modify the license attribute when sending to elasticsearch
        const disclaimer = DEFAULT_DISCLAIMER;
        const shortName = license;
        const typedName = shortName.split("-");
        return {
            short_name: shortName,
            typed_name: typedName,
            disclaimer,
            url: license_url
        };
    }

    function imageFormat(image: IQueryImage) {
        return {
            image_id: image.id,
            title: image.title,
            source: image.source,
            creator: image.creator,
            creator_url: image.creator_url,
            license: formatLicense(image.license, image.license_url),
            material_url: image.url,
            website: image.foreign_landing_url,
            height: image.height,
            width: image.width,
            cc_metadata_url: `https://search.creativecommons.org/photos/${image.id}`
        }
    }

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
        query("sort_by").optional().trim()
            .customSanitizer((value: string) => (value && value.length ? value.toLowerCase() : null)),
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
            sort_by,
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
        if (types && ["all", "text", "video", "audio", "image"].includes(types)) {
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

        if (sort_by === "creation_date") {
            filters.push({
                exists: {
                    field: "creation_date"
                }
            });
        }

        // check if we need to filter the documents
        const filterFlag = filters.length > 0;

        // ------------------------------------
        // Sort outpus
        // ------------------------------------

        const sortBy = [];

        if (sort_by === "creation_date") {
            sortBy.push({ creation_date: { order: "desc" } });
        } else if (sort_by === "retrieved_date") {
            sortBy.push({ retrieved_date: { order: "desc" } });
        }

        sortBy.push("_score");

        // ------------------------------------
        // Translate the user input
        // ------------------------------------

        const translation = text;
        // TODO: add the proper translation when it will be available

        // ------------------------------------
        // Check if the request is for images
        // ------------------------------------

        let totalHits: number;
        let totalPages: number;
        let results: any;
        let aggregations: any;

        if (typegroup === "image") {
            // make a request to the creative commons search API
            try {
                const output = await fetchImages(text, limit, page, licenses);
                // get the total number of results
                totalPages = output.page_count > 100 ? 100 : output.page_count;
                totalHits =  totalPages * 20;// output.result_count;
                // format the image results
                results = output.results.map((r: IQueryImage) => imageFormat(r));
            } catch (error) {
                console.log(error);
                return next(new ErrorHandler(500, "Internal server error"));
            }
        } else {

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
                        }, {
                            range: {
                                creation_date: {
                                    gte: "now-5y/d",
                                    lte:  "now/d",
                                    boost: 10.0
                                }
                            }
                        }],
                        ...filterFlag && {
                            filter: filters
                        }
                    }
                },
                ...sort_by && sort_by.length && { sort: sortBy },
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
                const output = await es.search("oer_materials", esQuery);
                // format the output before sending
                results = output.hits.hits.map((hit: IElasticsearchHit) =>
                    materialFormat(hit, wikipedia, wikipedia_limit, getContent, content_extension)
                );
                // prepare the metadata used to navigate through the search
                totalHits = output.hits.total.value;
                totalPages = Math.ceil(output.hits.total.value / size);

                output.aggregations.providers.buckets.forEach((provider: { key: string }) => {
                    provider.key = provider.key.toLowerCase();
                });
                // store the aggregations
                aggregations = output.aggregations;
            } catch (error) {
                console.log(error);
                return next(new ErrorHandler(500, "Internal server error"));
            }
        }

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

        const prevPage = page - 1 > 0 ? `${BASE_URL}?${querystring.stringify(prevQuery)}` : null;
        const nextPage = totalPages >= page + 1 ? `${BASE_URL}?${querystring.stringify(nextQuery)}` : null;

        // output the materials
        return res.status(200).json({
            query: req.query,
            rec_materials: results,
            metadata: {
                total_hits: totalHits,
                total_pages: totalPages,
                prev_page: prevPage,
                next_page: nextPage,
                ...aggregations && { aggregations: {
                        licenses: aggregations.licenses.buckets,
                        languages: aggregations.languages.buckets,
                        providers: aggregations.providers.buckets,
                        types: aggregations.types.buckets
                    }
                }
            }
        });
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
