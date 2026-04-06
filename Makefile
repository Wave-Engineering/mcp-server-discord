.PHONY: lint test build ci e2e

lint:
	bunx tsc --noEmit

test:
	bun test

build:
	./scripts/ci/build.sh

ci:
	./scripts/ci/validate.sh

e2e:
	DISCORD_INTEGRATION_TESTS=1 bun test tests/e2e/
