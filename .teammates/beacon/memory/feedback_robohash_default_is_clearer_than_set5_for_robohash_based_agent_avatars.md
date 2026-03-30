---
version: 0.7.2
name: RoboHash default is clearer than set5 for RoboHash-based agent avatars
description: When the user asks for RoboHash-based avatars, use the default RoboHash robot output unless they explicitly ask for a specific alternate set such as set5.
type: feedback
---
# RoboHash default is clearer than set5 for RoboHash-based agent avatars

## Feedback

When the product request is "use RoboHash with the agent's name for the avatar," prefer the default RoboHash output (`https://robohash.org/<seed>.png`) rather than `?set=set5`.

## Why

- `set5` is still served by RoboHash, but it renders Avataaars-style humans, which does not read as obviously RoboHash-based to the user.
- The plain RoboHash URL produces the default robot style shown in RoboHash's own usage examples.
- If a non-default set is desired, that should be an explicit product decision rather than an implementation guess.

## Apply this

- Keep deterministic seeding based on the stable agent identity.
- Use the default RoboHash URL unless the requested visual family is named explicitly.
- If a specific set is chosen later, document that choice in code comments or memory so it does not drift.
