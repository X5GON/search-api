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