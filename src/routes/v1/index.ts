import { Express } from "express";
import { IConfiguration } from "../../Interfaces";

import search from "./oer_materials";
import recommend from "./recommend";

// join all routers in a single function
export default function index(app: Express, config: IConfiguration) {
    // setup the microservices API routes
    app.use("/api/v1", search(config));
    app.use("/api/v1", recommend(config));
};
