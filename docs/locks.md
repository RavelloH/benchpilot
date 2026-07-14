# Locks

Exclusive locks use atomic `open(..., "wx")` files keyed by physical adapter identity. Ownership is random-token based and release verifies the token. An active lock requires an explicit dangerous flag to clear; expired locks can be cleared as stale.
