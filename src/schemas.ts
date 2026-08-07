// GENERATED from openapi.json — do not edit by hand.
//
// Per-route invocation contracts published inside the x402 402 challenge as
// `accepts[].outputSchema`. `input` tells an agent how to build the request
// (method, query/path params, JSON body fields); `output` is the JSON Schema of
// the 200 body it gets back once payment settles.
//
// Deriving these from `openapi.json` keeps the runtime challenge — which the
// x402scan discovery spec treats as authoritative — from ever contradicting the
// published spec. Regenerate whenever a paid route's parameters or response
// schema change.
//
// Keys match the paywall route map in `server.ts` exactly (`"<METHOD> <path>"`,
// with `:param` for path segments).

import type { RouteSchema } from "./payments.js";

export const ROUTE_SCHEMAS: Record<string, RouteSchema> = {
  "POST /generate": {
    "input": {
      "type": "http",
      "method": "POST",
      "bodyType": "json",
      "bodyFields": {
        "openapi": {
          "type": "object",
          "description": "The OpenAPI 3.x document."
        },
        "options": {
          "type": "object",
          "properties": {
            "baseUrl": {
              "type": "string",
              "description": "Overrides servers[0].url."
            },
            "contact": {
              "type": "string",
              "description": "Overrides info.contact.email."
            },
            "defaultPrice": {
              "type": "string",
              "description": "Price for paid operations with no declared amount, e.g. \"$0.001\"."
            },
            "frontmatter": {
              "type": "boolean",
              "default": true
            },
            "rails": {
              "type": "array",
              "description": "Rails to document. Defaults to the suite's dual-rail pair.",
              "items": {
                "type": "object"
              }
            },
            "manifestPath": {
              "type": "string",
              "default": "/.well-known/x402"
            },
            "openapiPath": {
              "type": "string",
              "default": "/openapi.json"
            }
          }
        }
      }
    },
    "output": {
      "type": "object",
      "required": [
        "skillMdVersion",
        "skillMd",
        "service",
        "validation",
        "generatedAt"
      ],
      "properties": {
        "skillMdVersion": {
          "type": "string"
        },
        "skillMd": {
          "type": "string",
          "description": "The generated file, ready to commit."
        },
        "service": {
          "type": "object",
          "properties": {
            "name": {
              "type": "string"
            },
            "baseUrl": {
              "type": "string"
            },
            "endpoints": {
              "type": "integer"
            },
            "paid": {
              "type": "integer"
            }
          }
        },
        "warnings": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "description": "Anything the generator had to guess. It never invents a price silently."
        },
        "validation": {
          "type": "object",
          "properties": {
            "valid": {
              "type": "boolean"
            },
            "score": {
              "type": "integer"
            },
            "summary": {
              "type": "object"
            },
            "findings": {
              "type": "array",
              "items": {
                "type": "object",
                "required": [
                  "rule",
                  "severity",
                  "title",
                  "detail",
                  "fix"
                ],
                "properties": {
                  "rule": {
                    "type": "string"
                  },
                  "severity": {
                    "type": "string",
                    "enum": [
                      "error",
                      "warning",
                      "info"
                    ]
                  },
                  "title": {
                    "type": "string"
                  },
                  "detail": {
                    "type": "string",
                    "description": "What is wrong in THIS document."
                  },
                  "fix": {
                    "type": "string"
                  },
                  "line": {
                    "type": "integer",
                    "description": "1-based, when the problem has a location."
                  }
                }
              }
            }
          }
        },
        "generatedAt": {
          "type": "string",
          "format": "date-time"
        },
        "receipt": {
          "type": [
            "object",
            "null"
          ]
        }
      }
    }
  },
  "POST /validate": {
    "input": {
      "type": "http",
      "method": "POST",
      "bodyType": "json",
      "bodyFields": {
        "skillMd": {
          "type": "string",
          "x-required": true
        }
      }
    },
    "output": {
      "type": "object",
      "required": [
        "skillMdVersion",
        "valid",
        "score",
        "summary",
        "service",
        "findings",
        "checkedAt"
      ],
      "properties": {
        "skillMdVersion": {
          "type": "string"
        },
        "valid": {
          "type": "boolean",
          "description": "True when there are zero errors."
        },
        "score": {
          "type": "integer",
          "minimum": 0,
          "maximum": 100
        },
        "summary": {
          "type": "object",
          "properties": {
            "errors": {
              "type": "integer"
            },
            "warnings": {
              "type": "integer"
            },
            "infos": {
              "type": "integer"
            }
          }
        },
        "service": {
          "type": "object",
          "description": "What the validator understood about the service from the document.",
          "properties": {
            "name": {
              "type": [
                "string",
                "null"
              ]
            },
            "baseUrl": {
              "type": [
                "string",
                "null"
              ]
            },
            "contact": {
              "type": [
                "string",
                "null"
              ]
            },
            "endpoints": {
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "method": {
                    "type": "string"
                  },
                  "path": {
                    "type": "string"
                  },
                  "price": {
                    "type": "string"
                  }
                }
              }
            },
            "rails": {
              "type": "object",
              "properties": {
                "evm": {
                  "type": "boolean"
                },
                "solana": {
                  "type": "boolean"
                }
              }
            },
            "dualRail": {
              "type": "boolean"
            }
          }
        },
        "findings": {
          "type": "array",
          "items": {
            "type": "object",
            "required": [
              "rule",
              "severity",
              "title",
              "detail",
              "fix"
            ],
            "properties": {
              "rule": {
                "type": "string"
              },
              "severity": {
                "type": "string",
                "enum": [
                  "error",
                  "warning",
                  "info"
                ]
              },
              "title": {
                "type": "string"
              },
              "detail": {
                "type": "string",
                "description": "What is wrong in THIS document."
              },
              "fix": {
                "type": "string"
              },
              "line": {
                "type": "integer",
                "description": "1-based, when the problem has a location."
              }
            }
          }
        },
        "checkedAt": {
          "type": "string",
          "format": "date-time"
        },
        "receipt": {
          "type": [
            "object",
            "null"
          ]
        }
      }
    }
  },
};
