import { Express } from "express";
import { IConfiguration } from "../../Interfaces";

// join all routers in a single function
export default function index(app: Express, config: IConfiguration) {
    // setup the microservices API routes
    app.use("/api/v1", require("./oer_materials")(config));
    app.use("/api/v1", require("./recommend")(config));
};
