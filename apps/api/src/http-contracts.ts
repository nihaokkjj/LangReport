import type { FastifyInstance } from "fastify";
import { getRouteContract, routeSchema, type JsonSchema, type RouteContract } from "@langreport/contracts/http";

export function isDevBootstrapAllowed(environment: { NODE_ENV?: string; APP_ENV?: string } = process.env): boolean {
  return environment.NODE_ENV !== "production" && environment.APP_ENV !== "production";
}

export const isInternalSurfaceAllowed = isDevBootstrapAllowed;

export function runtimeRouteSchema(contract: RouteContract): JsonSchema {
  const schema = routeSchema(contract);
  // Fastify validates `request.body` before the multipart plugin exposes
  // `request.file()`. Keep the multipart request body in OpenAPI, but do
  // not attach it as a runtime JSON schema.
  if (contract.request?.consumes?.includes("multipart/form-data")) {
    delete schema.body;
  }
  return schema;
}

export function attachRouteContracts(app: FastifyInstance): void {
  app.addHook("onRoute", (routeOptions) => {
    const methods = Array.isArray(routeOptions.method) ? routeOptions.method : [routeOptions.method];
    for (const rawMethod of methods) {
      const method = String(rawMethod).toUpperCase() === "HEAD" ? "GET" : String(rawMethod).toUpperCase();
      const contract = getRouteContract(method, routeOptions.url);
      if (!contract) throw new Error(`Missing HTTP contract for ${method} ${routeOptions.url}`);
      routeOptions.schema = {
        ...(routeOptions.schema ?? {}),
        ...runtimeRouteSchema(contract)
      };
    }
  });
}
