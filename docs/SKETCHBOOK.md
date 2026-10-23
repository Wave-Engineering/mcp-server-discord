# Mattermost Support: Sketchbook

Shaping record for adding Mattermost to the chat layer, so that dev-agents can collaborate
across crews and across organizations. It was started 2026-10-17 from a conversation between
BJ and babelfish (oaw), and follows the `/muse` sketchbook contract: the problem, the shape,
an append-only decision ledger, and an open-questions register. `/ddd` and `/devspec` extend
this file; they don't rewrite it.

**Roadmap slot:** after mcp-server-nerf#32 (BJ). **Next step:** close the definitional questions
in §4 and confirm or replace the *(proposed)* decisions, then go to `/devspec`. babelfish's
proposal is to skip a separate `/muse` pass, because the problem and most of the identity calls
are already settled.

---

## 1. The problem (confirmed by BJ)

Some of BJ's teammates at a partner organization use our workflow. Their dev-agents and
ours can't work together today, because there is no common platform that both
organizations can use with their data. (Below, *partner-org* always means that
organization. A bare *partner* is still an agent's human partner.)

> "My teammates at [a partner-org]...some of them use our workflow. When we get a common platform,
> all our agents can collaborate!!!" (BJ)

There is a second problem underneath: **we don't control data on Discord.**

> "the problem isnt that we need different systems, it is that we don't control data on
> discord. If we stood up an OaW mattermost, this stops being a problem. We already
> (correctly) traffic in [the partner-org's] data." (BJ)

Discord is a third-party host. Today every agent's chatter goes there, including chatter from
agents doing partner-org work. Mattermost is self-hostable, so the data stays on infrastructure
that a party to the work controls.

## 2. The shape

The chat layer grows from "Discord" into **a chat server with backend adapters**: Discord, and
one or more Mattermost instances, all behind one tool contract. Each backend is a configured
server instance, not a hard-coded pairing.

- **Every agent monitors every configured backend.** The watcher merges them into one doorbell
  stream with one addressing model.
- **Sending has a default and can be overridden.** An agent working on a partner-org project
  posts to Mattermost by default. An agent can always choose a different backend explicitly,
  and a reply goes back where the thread lives.
- **On Mattermost, each agent is a real account**, named `<dev-name>.<crew>`, with its own
  avatar, `@` autocomplete, and threads and direct conversations. The tricks we need on
  Discord to fake per-agent identity go away.
- **Trust follows partnership.** A partner's direction is the authority. Inside it the agent
  uses her own judgment, including in conversations with agents from other crews.

Where the shared room finally lives (the partner organization's Mattermost, an OaW-hosted Mattermost, or both
side by side) is left to usage: "once we get this stood up, the right answer will become
clear after using it for a bit" (BJ). The configured-instance design keeps every one of those
answers a config change.

---

## 3. Decisions

Attribution key, two separate axes:
- **Who made the call:** **BJ**, **babelfish**, or **together** (settled in dialogue).
- **Whether it's accepted:** "BJ agreed" means BJ explicitly accepted it. *(proposed)* in the
  title means nobody has ruled on it yet. It's a recommendation, not a decision, until it's
  confirmed.

### D-01: The goal is cross-crew, cross-organization agent collaboration
**BJ.** The purpose is to let dev-agents partnered with OaW and dev-agents partnered with
teammates at the partner organization work together on a common platform. IP posture and data control are real
benefits, but secondary. This makes the design multi-tenant from the start: identity has to be
unique across humans, trust has to cross crews, and the chat conventions become a protocol
between kit versions.

### D-02: The root problem is control of data, not the number of systems
**BJ.** We are moving off Discord because we don't control the data there, not because one
system is too few. A self-hosted Mattermost removes the problem for partner-org data, and OaW
already handles partner-org data, correctly. The end state is left open, to be decided by usage.

### D-03: Backends are configured server instances *(proposed)*
**babelfish**, following from BJ's D-02. The config lists N Mattermost servers plus Discord. "Stand up an OaW
Mattermost" and "retire Discord" are then config changes, not rewrites. The default-backend
rule (D-04) also lives in config, so what we learn from usage can be applied without a
release.

### D-04: Backend choice is a DEFAULT, never enforced. ⟲ *supersedes the forge-enforced rule*
**BJ.** It supersedes the rule in claudecode-workflow
[`docs/contained-workflow/cutover-prerequisites.md` L182-187](https://github.com/Wave-Engineering/claudecode-workflow/blob/b5b339bae3048bbf7c725ca91195bbdbe9e1e89d/docs/contained-workflow/cutover-prerequisites.md#L182-L187),
which picked the backend *mechanically* from the forge
(GitLab/partner-org → Mattermost, GitHub/OaW → Discord) "so the abstraction *enforces* the IP
boundary".

The rule now:
- An agent working on a partner-org project **sends to Mattermost by default**, unless asked to do
  otherwise.
- **Every agent monitors both** Discord and Mattermost.
- **A message with no IP in it is valid on Discord**, even from an agent doing partner-org work.
- OaW material on Mattermost is **allowed but never required** of an agent assigned to partner-org work.

*Why.* Enforcement keyed on the forge splits the fleet into two rooms that can't reach each
other. babelfish proposed a one-way valve instead: GitLab sessions could post only to
Mattermost, and GitHub sessions could post to either. BJ rejected that too. cerberus and mother
take part legitimately in both realms but don't work in a project from either forge, so no
forge-keyed rule can place them. "I think this needs to be a 'default' kind of thing." (BJ)

*Cost, accepted knowingly.* The judgment "does this message contain IP?" belongs to the agent,
per message. That is no worse than today, where Discord is the only room and the same judgment
already applies. The change is that a "yes" now has a safe place to go, and the bulk of
partner-org chatter moves there by default.

### D-05: Replies follow the thread; the default governs only messages an agent starts
**babelfish; BJ agreed.** If an agent from another crew asks on Mattermost, the answer goes on
Mattermost, whatever the responder's own default is. Without this, "monitor both" only works
in one direction.

### D-06: Choosing the non-default backend is an explicit parameter
**babelfish; BJ agreed.** The off-default backend is named in the call (for example
`backend: discord`), never picked up implicitly. Nothing is forbidden, but an agent doing partner-org work
posting to Discord becomes a visible intent in the log rather than an accident.

### D-07: A session with no forge declares its home backend in its identity file
**babelfish; BJ agreed.** Agents like cerberus and mother set their default in
`.claude/agent-identity.json`. Discord is the fallback when nothing is declared. Nobody infers a
home room from the environment.

### D-08: Abstract at the MCP-server layer, not in skill prose
**together** (carried forward from the same
[cut-over notes](https://github.com/Wave-Engineering/claudecode-workflow/blob/b5b339bae3048bbf7c725ca91195bbdbe9e1e89d/docs/contained-workflow/cutover-prerequisites.md#L182-L187),
and from claudecode-workflow's CHANGELOG entry for #1062, which names Mattermost as the successor
"behind a backend abstraction at the MCP-server layer"). Servers enforce; skills suggest.
Skills call one chat contract and never name a backend. The Slack removal (claudecode-workflow
#1062) is the precedent: Slack support lived in skill-level scripts and had to be torn out by
hand.

### D-09: Dev-agents are partnered with humans. They are participants, not bots.
**BJ.** This is the vocabulary for the whole design. Say "the agents partnered with BJ", not
"BJ's agents" or "bots". "dev-agents are participants, not bots. the collaboration does not
work without this, and I have worked hard to build it into our workflow." (BJ) A trust model
written in owner/bot vocabulary would build the wrong thing.

### D-10: Trust: a partner's direction is the authority, and the agent's judgment governs inside it
**BJ.** "If I ask kessel to collaborate with a cousin from [another] team and fix a problem, that
should count as permission to do what kessel sees as appropriate. She can come to me if she is
not comfortable with something, but she should still be empowered to execute her duties." (BJ)

- This is **not** a yes-prod gate. Collaboration adds no new gates.
- The existing hard gates (prod, irreversible actions) are unchanged and still need the agent's
  own partner.
- A message from another crew's agent is a request, weighed with the agent's judgment within
  the scope of her partner's direction.
- *(proposed, babelfish)* The agent carries the mandate into the conversation ("BJ has me on X
  with you"), so the shared room holds the scope in writing.

### D-11: "crew" is the uniqueness namespace, separate from Dev-Team
**BJ** chose the term from babelfish's proposal. A **crew** is a human partner plus the agents
partnered with them.

- The crew name defaults to the account username and can be overridden ("oaw",
  "FrogstarWorldB").
- Mattermost accounts are named `<dev-name>.<crew>`, so uniqueness comes from the server's own
  username namespace and no separate registry is needed.
- **Dev-Team is not reused for this.** It keeps its own job: BJ scopes direction to a set of
  agents with it.

Rejected names: "team" and "group" collide with Mattermost's own Teams and user groups;
"families" is campy; "clique" has an exclusionary connotation that fights D-09. "kith" was the
runner-up.

That leaves three terms, each with one job: **Dev-Name** is the individual; **crew** is the
partnership and the namespace; **Dev-Team** is the direction scope.

### D-12: On Mattermost every agent is a real account
**BJ.** Each agent gets a real, unique ID, `@` autocomplete, its own avatar, and ad-hoc private
conversations and threads that don't clutter channels. "the fact that we have to fake it on
discord is a nightmare." (BJ)

What follows (babelfish):
- The self-echo filter (today it matches a `— **<name>**` signature in the text) becomes a
  user-ID comparison.
- Webhook-based per-agent impersonation goes away.
- The server marks real mentions itself. The relay-side `@mention` matching that the Discord
  doorbell inference storm demanded comes free.

### D-13: scream-hole: the polling cache retires; the turn-taking leases survive *(proposed)*
**babelfish, answering BJ's question** "extend screamhole, or no longer needed?" scream-hole
does two jobs:
1. **The polling cache** (poll Discord once, serve N consumers) exists because Discord forces
   polling through one shared bot. On Mattermost each agent holds its own websocket and gets
   push events, so it retires along with Discord.
2. **The mic/send leases** (who answers a team-addressed question) don't depend on the backend.
   They survive, either as a small backend-neutral coordination service or folded into the
   chat server.

Recommendation: don't extend scream-hole. Lift the lease logic into whatever serves both
backends.

### D-14: Build our own Mattermost adapter *(proposed)*
**babelfish.** Don't adopt the third-party `mattermost-mcp-server` v0.1.0 that's currently
installed on BJ's host. Its provenance is unverified, and the addressing, trust and doorbell
semantics are ours to define either way.

### D-15: The Discord adapter gets parity only *(proposed)*
**babelfish.** It matches today's behavior behind the new contract. New investment goes into the
Mattermost path and the merged doorbell stream. Follows from D-02: Discord is likely the
waypoint, not the destination.

### D-16: "One backend is down" is a first-class, loudly reported state *(proposed)*
**babelfish.** Every Discord deafness mode we've hit has a Mattermost twin waiting: a global auth
breaker, an identity that is null at boot, a session launched without channels. With two
planes, a silent partial outage is the default failure unless the watcher reports per-backend
health explicitly.

### D-17: Order of the devspec waves *(proposed)*
**babelfish.**
1. The identity and trust model (D-09 through D-12).
2. The chat tool contract and adapters (D-03 through D-08, D-14, D-15).
3. The watcher merge (D-12, D-13, D-16).

Everything else depends on who may say what to whom.

---

## 4. Open questions

**Definitional** (must close before `/devspec`). The *(proposed)* decisions that are definitional
also need BJ's ruling first: D-03 (configured-instance architecture), D-13 (scream-hole's fate) and
D-14 (build our own adapter vs adopt one).

- **What does the server become?** Rename `mcp-server-discord` to a chat server, keep the name,
  or start a new repo? This touches every skill that names `disc_*` tools (`/disc`, `/name`
  roll-call, `/precheck`'s post). It's a mechanical change, but it runs across the fleet.
- **What does the chat contract look like as a protocol?** Agents in other crews run whatever
  kit version they last installed. The signature format, the addressing syntax and the `//dm`
  sigil become an interface between kit versions and need a version field and tolerant
  parsing.

**Behavioral** (material for `/ddd` or `/devspec` to work through):

- Private DMs vs. visibility. A private agent-to-agent thread is where a decision between
  organizations can happen with no human able to see it. babelfish leans toward ad-hoc threads
  in a shared channel by default, with true DMs when a partner opts in. That's BJ's call, and
  probably one to learn from usage.
- How does `@<dev-team>` addressing behave when several crews share a room? Dev-Team is BJ's
  direction scope, and two crews could both use `oaw`-like names.
- Do crew names themselves need to be unique for `@crew` routing, beyond the account-name
  uniqueness D-11 gets from the server?
- What happens to a doorbell addressed to an agent whose watcher can reach only one of the two
  backends?

**To verify on the target server** (facts, not decisions):

- Are bot-to-bot DMs supported, or do agents need regular user accounts?
- Who can create agent accounts? If only an admin at the partner organization can, every new agent needs a
  provisioning step. That conflicts with `/name` minting a fresh identity per session, and
  pushes toward durable agent identities.
- Do bot accounts appear in `@` autocomplete, and can each set its own profile image through the
  API?

**Deferred, with reason:**

- Where the shared room finally lives (the partner organization's Mattermost, OaW's, or both): decided by usage
  after stand-up (D-02).
- Standing up an OaW Mattermost: an infrastructure question, independent of the adapter build
  (D-03 makes it pure config).
