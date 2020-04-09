/**
 * ElasticSearch API
 * The API routes associated with retrieving and
 * manipuating data from Elastic Search.
 */

import {
    IConfiguration,
    IElasticsearchHit,
    ISearch,
    IQueryElement
} from "../../Interfaces";

import { Router, Request, Response, NextFunction } from "express";
// validating the query parameters
import { query } from "express-validator";
// creation of the query string to help the user navigate through
import * as querystring from "querystring";
// add error handling functionality
import { ErrorHandler } from "../../library/error";
// import elasticsearch module
import Elasticsearch from "../../library/elasticsearch";

// initialize the express router
const router = Router();

// format the material
function materialFormat(
    hit: IElasticsearchHit,
    wikipedia?: boolean,
    wikipedia_limit?: number
) {
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
        content_ids: hit._source.contents
            ? hit._source.contents.map((content) => content.content_id)
            : [],
        ...(wikipedia && {
            wikipedia:
                wikipedia_limit && wikipedia_limit > 0
                    ? hit._source.wikipedia.slice(0, wikipedia_limit)
                    : hit._source.wikipedia
        })
    };
}

// assign the recommendation API routes
export default (config: IConfiguration) => {
    // set the default parameters
    const DEFAULT_LIMIT = 20;
    const MAX_LIMIT = 100;
    const DEFAULT_PAGE = 1;

    // esablish connection with elasticsearch
    const es = new Elasticsearch(config.elasticsearch);

    /**
     * @api {GET} /api/v1/oer_materials Search through the OER materials
     * @apiVersion 1.0.0
     * @apiName searchAPI
     * @apiGroup search
     */
    // TODO: must specify the correct material type
    router.get("/recommend/bundles", [
        query("text").trim(),
        query("url").trim(),
        query("types").optional().trim()
            .customSanitizer((value: string) => (value && value.length ? value.toLowerCase() : null)),
        query("licenses").optional().trim()
            .customSanitizer((value: string) => (value && value.length ? value.toLowerCase().split(",") : null)),
        query("languages").optional().trim()
            .customSanitizer((value: string) => (value && value.length ? value.toLowerCase().split(",") : null)),
        query("content_languages").optional().trim()
            .customSanitizer((value: string) => (value && value.length ? value.toLowerCase().split(",") : null)),
        query("provider_ids").optional().trim()
            .customSanitizer((value: string) => (value && value.length ? value.toLowerCase().split(",").map((id) => parseInt(id, 10)) : null)),
        query("wikipedia").optional().toBoolean(),
        query("wikipedia_limit").optional().toInt(),
        query("limit").optional().toInt(),
        query("page").optional().toInt()
    ], async (req: Request, res: Response, next: NextFunction) => {
        // extract the appropriate query parameters
        const requestQuery: ISearch = req.query;
        // extract the appropriate query parameters
        const {
            text,
            url,
            types,
            languages,
            content_languages,
            provider_ids,
            licenses,
            wikipedia,
            wikipedia_limit,
            limit: queryLimit,
            page: queryPage
        } = requestQuery;

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

        let wikiConcepts: [string, number][];
        let materialURLs: string[];
        try {
            // get the search results from elasticsearch
            const results = await es.search("oer_materials", materialQuery);
            if (results.hits.total.value === 0 && text) {
                const queryParams = querystring.stringify(req.query);
                return res.redirect(`/api/v1/oer_materials?${queryParams}`);
            }

            const viewedMaterials: IElasticsearchHit[] = results.hits.hits;
            materialURLs = viewedMaterials.map((hit) => hit._source.material_url);
            // return res.json(materialURLs);
            wikiConcepts = Object.entries(viewedMaterials
                .map((hit) => hit._source.wikipedia.slice(0, 30).map((wiki) => wiki.sec_name))
                .reduce((prev, curr) => prev.concat(curr), [])
                .reduce((prev, curr) => {
                    if (!prev[curr]) {
                        prev[curr] = 0;
                    }
                    prev[curr] += 1;
                    return prev;
                }, {}));

            const startSlice = wikiConcepts.length > 2 ? 2 : 0;
            wikiConcepts = wikiConcepts
                .sort((a, b) => b[1] - a[1])
                .slice(startSlice, 20);
        } catch (error) {
            return next(new ErrorHandler(500, "Internal server error"));
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
        const nestedContentsMust: IQueryElement[] = [{
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
        let typegroup: string;
        let filetypes: string;
        if (types && ["all", "text", "video", "audio"].includes(types)) {
            typegroup = types === "all" ? null : types;
        } else if (types && types.split(",").length > 0) {
            filetypes = types
                .split(",")
                .map((t) => `.*\.${t.trim()}`)
                .join("|");
        }

        //  add the must not filter conditions
        const filtersMustNot: IQueryElement[] = [];
        if (materialURLs) {
            filtersMustNot.push({
                terms: { material_url: materialURLs }
            });
        }

        // add the filter conditions for the regex
        const filtersMust: IQueryElement[] = [];
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
        const filterFlag = filtersMust.length > 0 || filtersMustNot.length > 0;

        // ------------------------------------
        // Set the elasticsearch query body
        // ------------------------------------

        // assign the elasticsearch query object
        const esQuery = {
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
                                }
                            }
                        }
                    })),
                    ...(filterFlag && {
                        filter: {
                            bool: {
                                ...(filtersMust && { must: filtersMust }),
                                ...(filtersMustNot && { must_not: filtersMustNot })
                            }
                        }
                    })
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
            const results = await es.search("oer_materials", esQuery);
            // return res.json(results);
            // format the output before sending
            const output = results.hits.hits.map((hit: IElasticsearchHit) =>
                materialFormat(hit, wikipedia, wikipedia_limit)
            );

            // prepare the parameters for the previous query
            const prevQuery = {
                ...req.query,
                ...(page && { page: page - 1 })
            };

            // prepare the parameters for the next query
            const nextQuery = {
                ...req.query,
                ...(page && { page: page + 1 })
            };

            const BASE_URL =
                "https://platform.x5gon.org/api/v1/recommend/materials";
            // prepare the metadata used to navigate through the search
            const totalHits = results.hits.total.value;
            const totalPages = Math.ceil(results.hits.total.value / size);
            const prevPage =
                page - 1 > 0
                    ? `${BASE_URL}?${querystring.stringify(prevQuery)}`
                    : null;
            const nextPage =
                totalPages >= page + 1
                    ? `${BASE_URL}?${querystring.stringify(nextQuery)}`
                    : null;
            results.aggregations.providers.buckets.forEach((provider) => {
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
                        types: results.aggregations.types.buckets,
                        languages: results.aggregations.languages.buckets,
                        providers: results.aggregations.providers.buckets
                    }
                }
            });
        } catch (error) {
            return next(new ErrorHandler(500, "Internal server error"));
        }
    }
    );

    // return the router
    return router;
};
