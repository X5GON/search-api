////////////////////////////////////////////////////////////////////////
// Configurations

export interface IConfigCommon {
    environment: string,
}

export interface IConfigENV {
    port: number,
    sessionsecret?: string,
    elasticsearch: {
        node: string
    }
}

export interface IConfiguration {
    environment?: string,
    port: number,
    sessionsecret?: string,
    elasticsearch: {
        node: string
    }
}

////////////////////////////////////////////////////////////////////////
// Elasticsearch records

export interface IContent {
    content_id: number
}

export interface IWikipedia {
    uri: string,
    name: string,
    sec_uri: string,
    sec_name: string
}

export interface IElasticsearchHit {
    _score: number,
    _source: {
        material_id: number,
        title: string,
        description: string,
        creation_date: string,
        retrieved_date: string,
        type: string,
        mimetype: string,
        material_url: string,
        website_url: string,
        language: string,
        license: {
            short_name: string,
            typed_name?: string[],
            disclaimer: string,
            url: string
        },
        contents?: IContent[],
        provider_id: number,
        provider_name: string,
        provider_url: string,
        wikipedia: IWikipedia[]
    }
}


////////////////////////////////////////////////////////////////////////
// Express API routes

export interface ISearch {
    text?: string,
    url?: string,
    types?: string,
    licenses?: string,
    languages?: string,
    content_languages?: string,
    provider_ids?: string,
    wikipedia?: boolean,
    wikipedia_limit?: number,
    limit?: number,
    page?: number
}

export interface IQueryElement {
    term?: object,
    terms?: object,
    regexp?: object,
    exists?: object
}