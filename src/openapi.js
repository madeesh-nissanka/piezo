// Piezo v0.3.0 - MIT License - Copyright (c) Madeesh P. Nissanka
// Hand-authored OpenAPI 3.0.3 document plus the canonical route table (ROUTES).

export const ROUTES = [
  { method: "GET", path: "/health" },
  { method: "GET", path: "/openapi.json" },
  { method: "GET", path: "/adapters" },
  { method: "GET", path: "/adapters/:name" },
  { method: "POST", path: "/adapters/validate" },
  { method: "POST", path: "/jobs" },
  { method: "GET", path: "/jobs" },
  { method: "GET", path: "/jobs/:id" },
  { method: "POST", path: "/jobs/:id/cancel" },
  { method: "GET", path: "/jobs/:id/log" },
  { method: "GET", path: "/jobs/:id/events" },
  { method: "GET", path: "/jobs/:id/metrics" },
  { method: "GET", path: "/jobs/:id/manifest" },
  { method: "GET", path: "/jobs/:id/artifacts" },
  { method: "GET", path: "/jobs/:id/artifacts/:file" },
  { method: "GET", path: "/jobs/:id/summary" },
  { method: "GET", path: "/jobs/:id/stream" },
  { method: "GET", path: "/jobs/:id/wait" },
  { method: "POST", path: "/studies" },
  { method: "GET", path: "/studies/:id" },
  { method: "GET", path: "/studies/:id/export" },
  { method: "GET", path: "/" },
];

const json = (schema) => ({ "application/json": { schema } });
const errResp = (description) => ({
  description,
  content: json({ $ref: "#/components/schemas/Error" }),
});

const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
const paramRef = (name) => ({ $ref: `#/components/parameters/${name}` });

function buildDocument() {
  return {
    openapi: "3.0.3",
    info: {
      title: "Piezo API",
      description:
        "Protocol-free gateway for agent-driven engineering solvers with live log telemetry.",
      version: "0.3.0",
      license: { name: "MIT", url: "https://opensource.org/licenses/MIT" },
    },
    servers: [
      { url: "http://127.0.0.1:7421", description: "Local Piezo server" },
    ],
    tags: [
      { name: "system", description: "Health and API metadata" },
      { name: "adapters", description: "Solver adapter definitions" },
      { name: "jobs", description: "Solver job lifecycle and telemetry" },
      { name: "studies", description: "Parameter study batches" },
      { name: "dashboard", description: "Web dashboard" },
    ],
    security: [{ bearerAuth: [] }],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "opaque",
          description: "Bearer token; required for non-localhost binds.",
        },
      },
      parameters: {
        Limit: {
          name: "limit",
          in: "query",
          required: false,
          schema: { type: "integer", minimum: 0, maximum: 1000, default: 50 },
        },
        Offset: {
          name: "offset",
          in: "query",
          required: false,
          schema: { type: "integer", minimum: 0, default: 0 },
        },
        Status: {
          name: "status",
          in: "query",
          required: false,
          schema: {
            type: "string",
            enum: ["queued", "running", "retrying", "exited", "failed", "timeout", "cancelled"],
          },
        },
        StudyIdQuery: {
          name: "study_id",
          in: "query",
          required: false,
          schema: { type: "string" },
        },
        From: {
          name: "from",
          in: "query",
          required: false,
          schema: { type: "integer", minimum: 0, default: 0 },
        },
        Tail: {
          name: "tail",
          in: "query",
          required: false,
          schema: { type: "integer", minimum: 0, default: 0 },
        },
        Recent: {
          name: "recent",
          in: "query",
          required: false,
          schema: { type: "integer", minimum: 1 },
        },
        MetricName: {
          name: "name",
          in: "query",
          required: false,
          schema: { type: "string" },
        },
        ExportFormat: {
          name: "format",
          in: "query",
          required: false,
          schema: { type: "string", enum: ["csv", "json"], default: "json" },
        },
        TimeoutMs: {
          name: "timeout_ms",
          in: "query",
          required: false,
          schema: { type: "integer", minimum: 0 },
        },
        StreamFormat: {
          name: "format",
          in: "query",
          required: false,
          schema: { type: "string", enum: ["sse", "ndjson"], default: "sse" },
        },
        JobId: { name: "id", in: "path", required: true, schema: { type: "string" } },
        AdapterName: { name: "name", in: "path", required: true, schema: { type: "string" } },
        ArtifactFile: {
          name: "file",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
        StudyId: { name: "id", in: "path", required: true, schema: { type: "string" } },
      },
      schemas: {
        Error: {
          type: "object",
          required: ["error"],
          properties: {
            error: {
              type: "object",
              required: ["code", "message"],
              properties: {
                code: { type: "string", example: "BAD_REQUEST" },
                message: { type: "string" },
                details: { type: "object", additionalProperties: true },
                request_id: { type: "string" },
              },
            },
          },
        },
        Pattern: {
          type: "object",
          required: ["name", "regex"],
          properties: {
            name: { type: "string" },
            regex: { type: "string" },
            flags: { type: "string" },
            type: {
              type: "string",
              enum: ["progress", "warning", "error", "converged", "diverged", "iteration", "info"],
            },
            fields: { type: "array", items: { type: "string" } },
            severity: { type: "string" },
          },
        },
        Adapter: {
          type: "object",
          required: ["name", "executable", "args_template", "allowed_executables", "patterns"],
          properties: {
            name: { type: "string" },
            executable: { type: "string" },
            args_template: { type: "array", items: { type: "string" } },
            allowed_executables: { type: "array", items: { type: "string" } },
            patterns: { type: "array", items: ref("Pattern") },
            timeout_s: { type: "number" },
            resources: { type: "object", additionalProperties: true },
            summarizer: { type: "string" },
            forbidden_args: { type: "array", items: { type: "string" } },
            raw_args: { type: "boolean" },
            env_passthrough: { type: "array", items: { type: "string" } },
          },
        },
        AdapterSummary: {
          type: "object",
          required: ["name", "executable"],
          properties: {
            name: { type: "string" },
            executable: { type: "string" },
            version: { type: "string", nullable: true },
            file: { type: "string" },
          },
        },
        JobSubmit: {
          type: "object",
          required: ["adapter", "input"],
          properties: {
            adapter: {
              oneOf: [{ type: "string" }, ref("Adapter")],
              description: "Builtin name, adapter path reference or inline adapter object.",
            },
            input: { type: "string" },
            extra_args: { type: "array", items: { type: "string" } },
            cwd: { type: "string" },
            timeout_s: { type: "number" },
            priority: { type: "integer", minimum: 0, maximum: 9, default: 5 },
            retries: { type: "integer", minimum: 0, default: 0 },
            retry_backoff_ms: { type: "integer", minimum: 0 },
          },
        },
        JobStatus: {
          type: "object",
          required: ["id", "state"],
          properties: {
            id: { type: "string" },
            name: { type: "string" },
            adapterName: { type: "string" },
            input: { type: "string" },
            state: {
              type: "string",
              enum: ["queued", "running", "retrying", "exited", "failed", "timeout", "cancelled"],
            },
            startTime: { type: "number", nullable: true },
            endTime: { type: "number", nullable: true },
            exitCode: { type: "integer", nullable: true },
            signal: { type: "string", nullable: true },
            lineCount: { type: "integer" },
            summary: { type: "object", additionalProperties: true },
            pid: { type: "integer", nullable: true },
          },
        },
        PaginatedJobs: {
          type: "object",
          required: ["items", "total", "limit", "offset", "next_offset"],
          properties: {
            items: { type: "array", items: ref("JobStatus") },
            total: { type: "integer" },
            limit: { type: "integer" },
            offset: { type: "integer" },
            next_offset: { type: "integer", nullable: true },
          },
        },
        LogLine: {
          type: "object",
          properties: {
            line_no: { type: "integer" },
            stream: { type: "string", enum: ["stdout", "stderr"] },
            text: { type: "string" },
            t: { type: "number" },
          },
        },
        Event: {
          type: "object",
          properties: {
            t: { type: "number" },
            line_no: { type: "integer" },
            type: { type: "string" },
            severity: { type: "string", enum: ["debug", "info", "warn", "error"] },
            name: { type: "string" },
            fields: { type: "object", additionalProperties: true },
            text: { type: "string" },
            stream: { type: "string" },
          },
        },
        MetricPoint: {
          type: "object",
          required: ["t", "v"],
          properties: { t: { type: "number" }, v: { type: "number" } },
        },
        MetricsSnapshot: {
          type: "object",
          properties: {
            series: { type: "object", additionalProperties: true },
            eta_estimate_s: { type: "number", nullable: true },
          },
          additionalProperties: true,
        },
        Artifact: {
          type: "object",
          properties: {
            name: { type: "string" },
            path: { type: "string" },
            size: { type: "integer" },
            mime: { type: "string" },
          },
        },
        Manifest: { type: "object", additionalProperties: true },
        Summary: { type: "object", additionalProperties: true },
        HealthResponse: {
          type: "object",
          required: ["status"],
          properties: {
            status: { type: "string", example: "ok" },
            jobs: { type: "integer" },
            runs: { type: "integer" },
            version: { type: "string" },
          },
        },
        WaitResponse: {
          type: "object",
          required: ["lines", "events", "status"],
          properties: {
            lines: { type: "array", items: ref("LogLine") },
            events: { type: "array", items: ref("Event") },
            status: ref("JobStatus"),
            next_offset: { type: "integer" },
          },
        },
        StudySpec: {
          type: "object",
          properties: {
            template: ref("JobSubmit"),
            plan: {
              type: "object",
              properties: { type: { type: "string", enum: ["grid", "sweep", "lhs"] } },
              additionalProperties: true,
            },
          },
          additionalProperties: true,
        },
        StudySubmitResponse: {
          type: "object",
          required: ["study_id", "jobs"],
          properties: {
            study_id: { type: "string" },
            jobs: { type: "array", items: { type: "object", additionalProperties: true } },
          },
        },
        StudyTable: {
          type: "object",
          required: ["study_id", "rows"],
          properties: {
            study_id: { type: "string" },
            rows: { type: "array", items: { type: "object", additionalProperties: true } },
          },
        },
        ValidateResponse: {
          type: "object",
          properties: {
            ok: { type: "boolean" },
            errors: { type: "array", items: { type: "object", additionalProperties: true } },
          },
        },
      },
      responses: {
        BadRequest: errResp("Bad request"),
        NotFound: errResp("Not found"),
        Unauthorized: errResp("Unauthorized"),
        TooLarge: errResp("Payload too large"),
        Conflict: errResp("Conflict"),
        ServerError: errResp("Internal server error"),
      },
    },
    paths: {
      "/health": {
        get: {
          tags: ["system"],
          summary: "Health check",
          operationId: "getHealth",
          responses: {
            200: { description: "Service health", content: json(ref("HealthResponse")) },
          },
        },
      },
      "/openapi.json": {
        get: {
          tags: ["system"],
          summary: "This OpenAPI document",
          operationId: "getOpenApi",
          responses: {
            200: { description: "OpenAPI 3.0.3 document", content: json({ type: "object" }) },
          },
        },
      },
      "/adapters": {
        get: {
          tags: ["adapters"],
          summary: "List adapters",
          operationId: "listAdapters",
          responses: {
            200: {
              description: "Adapter summaries",
              content: json({ type: "array", items: ref("AdapterSummary") }),
            },
            401: errResp("Unauthorized"),
            500: errResp("Internal server error"),
          },
        },
      },
      "/adapters/{name}": {
        get: {
          tags: ["adapters"],
          summary: "Get one adapter",
          operationId: "getAdapter",
          parameters: [paramRef("AdapterName")],
          responses: {
            200: { description: "Adapter", content: json(ref("Adapter")) },
            404: errResp("Not found"),
          },
        },
      },
      "/adapters/validate": {
        post: {
          tags: ["adapters"],
          summary: "Validate an adapter definition",
          operationId: "validateAdapter",
          requestBody: {
            required: true,
            content: json(ref("Adapter")),
          },
          responses: {
            200: { description: "Validation result", content: json(ref("ValidateResponse")) },
            400: errResp("Bad request"),
          },
        },
      },
      "/jobs": {
        get: {
          tags: ["jobs"],
          summary: "List jobs",
          operationId: "listJobs",
          parameters: [
            { name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 0, maximum: 1000, default: 50 } },
            { name: "offset", in: "query", required: false, schema: { type: "integer", minimum: 0, default: 0 } },
            { name: "status", in: "query", required: false, schema: { type: "string", enum: ["queued", "running", "retrying", "exited", "failed", "timeout", "cancelled"] } },
            { name: "study_id", in: "query", required: false, schema: { type: "string" } },
          ],
          responses: {
            200: { description: "Paginated jobs", content: json(ref("PaginatedJobs")) },
            400: errResp("Bad request"),
          },
        },
        post: {
          tags: ["jobs"],
          summary: "Submit a solver job",
          operationId: "submitJob",
          requestBody: { required: true, content: json(ref("JobSubmit")) },
          responses: {
            202: {
              description: "Accepted",
              content: json({
                type: "object",
                required: ["id"],
                properties: { id: { type: "string" }, state: { type: "string" } },
              }),
            },
            400: { description: "Invalid job specification", content: json(ref("Error")) },
            413: errResp("Payload too large"),
          },
        },
      },
      "/jobs/{id}": {
        get: {
          tags: ["jobs"],
          summary: "Get job status",
          operationId: "getJob",
          parameters: [paramRef("JobId")],
          responses: {
            200: { description: "Job status", content: json(ref("JobStatus")) },
            404: errResp("Not found"),
          },
        },
      },
      "/jobs/{id}/cancel": {
        post: {
          tags: ["jobs"],
          summary: "Cancel a job",
          operationId: "cancelJob",
          parameters: [paramRef("JobId")],
          requestBody: {
            required: false,
            content: json({
              type: "object",
              properties: { force: { type: "boolean", default: false } },
            }),
          },
          responses: {
            200: {
              description: "Cancellation result",
              content: json({
                type: "object",
                properties: { cancelled: { type: "boolean" }, id: { type: "string" } },
              }),
            },
            404: errResp("Not found"),
          },
        },
      },
      "/jobs/{id}/log": {
        get: {
          tags: ["jobs"],
          summary: "Read job log lines",
          operationId: "getJobLog",
          parameters: [
            paramRef("JobId"),
            { name: "from", in: "query", required: false, schema: { type: "integer", minimum: 0, default: 0 } },
            { name: "tail", in: "query", required: false, schema: { type: "integer", minimum: 0, default: 0 } },
          ],
          responses: {
            200: {
              description: "Log lines",
              content: json({
                type: "object",
                properties: { lines: { type: "array", items: ref("LogLine") } },
              }),
            },
            404: errResp("Not found"),
          },
        },
      },
      "/jobs/{id}/events": {
        get: {
          tags: ["jobs"],
          summary: "Read parsed events",
          operationId: "getJobEvents",
          parameters: [paramRef("JobId"), paramRef("From")],
          responses: {
            200: {
              description: "Events",
              content: json({
                type: "object",
                properties: { events: { type: "array", items: ref("Event") } },
              }),
            },
            404: errResp("Not found"),
          },
        },
      },
      "/jobs/{id}/metrics": {
        get: {
          tags: ["jobs"],
          summary: "Read metric series",
          operationId: "getJobMetrics",
          parameters: [
            paramRef("JobId"),
            paramRef("MetricName"),
            paramRef("Recent"),
          ],
          responses: {
            200: { description: "Metrics", content: json(ref("MetricsSnapshot")) },
            404: errResp("Not found"),
          },
        },
      },
      "/jobs/{id}/manifest": {
        get: {
          tags: ["jobs"],
          summary: "Read job provenance manifest",
          operationId: "getJobManifest",
          parameters: [paramRef("JobId")],
          responses: {
            200: { description: "Manifest", content: json(ref("Manifest")) },
            404: errResp("Not found"),
          },
        },
      },
      "/jobs/{id}/artifacts": {
        get: {
          tags: ["jobs"],
          summary: "List job artifacts",
          operationId: "listJobArtifacts",
          parameters: [paramRef("JobId")],
          responses: {
            200: {
              description: "Artifacts",
              content: json({
                type: "object",
                properties: { artifacts: { type: "array", items: ref("Artifact") } },
              }),
            },
            404: errResp("Not found"),
          },
        },
      },
      "/jobs/{id}/artifacts/{file}": {
        get: {
          tags: ["jobs"],
          summary: "Download an artifact",
          operationId: "downloadArtifact",
          parameters: [paramRef("JobId"), paramRef("ArtifactFile")],
          responses: {
            200: {
              description: "Artifact bytes",
              content: { "application/octet-stream": { schema: { type: "string", format: "binary" } } },
            },
            404: errResp("Not found"),
          },
        },
      },
      "/jobs/{id}/summary": {
        get: {
          tags: ["jobs"],
          summary: "Get job summary",
          operationId: "getJobSummary",
          parameters: [paramRef("JobId")],
          responses: {
            200: { description: "Summary", content: json(ref("Summary")) },
            404: errResp("Not found"),
          },
        },
      },
      "/jobs/{id}/stream": {
        get: {
          tags: ["jobs"],
          summary: "Stream job telemetry (SSE or NDJSON)",
          operationId: "streamJob",
          parameters: [
            paramRef("JobId"),
            { name: "from", in: "query", required: false, schema: { type: "integer", minimum: 0, default: 0 } },
            paramRef("StreamFormat"),
          ],
          responses: {
            200: {
              description: "Event stream",
              content: {
                "text/event-stream": { schema: { type: "string" } },
                "application/x-ndjson": { schema: { type: "string" } },
              },
            },
            404: errResp("Not found"),
          },
        },
      },
      "/jobs/{id}/wait": {
        get: {
          tags: ["jobs"],
          summary: "Long-poll for new telemetry",
          operationId: "waitJob",
          parameters: [
            paramRef("JobId"),
            paramRef("From"),
            paramRef("TimeoutMs"),
          ],
          responses: {
            200: { description: "New data or timeout", content: json(ref("WaitResponse")) },
            404: errResp("Not found"),
          },
        },
      },
      "/studies": {
        post: {
          tags: ["studies"],
          summary: "Expand and submit a parameter study",
          operationId: "submitStudy",
          requestBody: { required: true, content: json(ref("StudySpec")) },
          responses: {
            202: { description: "Study accepted", content: json(ref("StudySubmitResponse")) },
            400: errResp("Bad request"),
          },
        },
      },
      "/studies/{id}": {
        get: {
          tags: ["studies"],
          summary: "Get study table",
          operationId: "getStudy",
          parameters: [paramRef("StudyId")],
          responses: {
            200: { description: "Study table", content: json(ref("StudyTable")) },
            404: errResp("Not found"),
          },
        },
      },
      "/studies/{id}/export": {
        get: {
          tags: ["studies"],
          summary: "Export study table",
          operationId: "exportStudy",
          parameters: [paramRef("StudyId"), paramRef("ExportFormat")],
          responses: {
            200: {
              description: "Exported table",
              content: {
                "text/csv": { schema: { type: "string" } },
                "application/json": { schema: { type: "array", items: { type: "object" } } },
              },
            },
            404: errResp("Not found"),
          },
        },
      },
      "/": {
        get: {
          tags: ["dashboard"],
          summary: "Web dashboard",
          operationId: "getDashboard",
          responses: {
            200: {
              description: "HTML dashboard",
              content: { "text/html": { schema: { type: "string" } } },
            },
          },
        },
      },
    },
  };
}

export function openapiDocument() {
  return buildDocument();
}
