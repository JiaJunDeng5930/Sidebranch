# Native Sites MCP and reader entrypoints

Date: 2026-10-01

Status: accepted

## Context

The published Site did not declare an MCP capability, so Sites could not provision its native plugin. The existing connector depended on an application-owned OAuth service and opaque tokens. Keeping that token verifier while enabling platform authentication would reject valid platform requests and retain a second identity authority.

The reader already runs as an MCP App. Requiring a document tool call to reach it adds friction when the user wants to read alongside a conversation. The [official plugin extension mechanism](https://developers.openai.com/plugins/build/extensions) supports global and conversation entrypoints for an existing UI resource.

## Decision and reasons

Use Sites as the authentication authority for browser and native MCP requests. Continue binding the document space to the trusted, Site-specific owner identity and enforcing document read/write permissions inside each tool. A platform service bypass credential is not a user identity. Retire application-issued OAuth endpoints and token verification without deleting historical migrations, owner bindings, document rows or assets.

Separate public protocol discovery and the credential-free reader HTML from authorized document operations. Resolve the owner-backed document store only when a tool is invoked, with an additional HTTP authorization check for tool calls. This permits platform discovery while keeping document access fail closed even when a new handler is added.

Expose the existing reading space through both global and conversation entrypoints. They use the same reader resource and preserve the current document, immutable revision and selected passage identities. Keep document-specific opening available to tools. Reader navigation remains the user's reading space, rather than introducing another backend event system.

Register tools through the MCP SDK to preserve Zod object schema types, and declare UI resource metadata using the current protocol directly rather than duplicating legacy metadata.

## Consequences and verification boundary

Sites owns connection authentication and native plugin provisioning. Enabling the capability requires publishing a version; it does not establish that the user has installed the plugin. Historical OAuth tables may remain in D1, but their tokens no longer grant access. Local protocol and reader-host checks verify authorization and bridge behavior; actual platform provisioning, global/sidebar launch and conversation launch require ChatGPT host validation.
