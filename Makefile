.PHONY: check lint typecheck test e2e build dev

check: ## Run everything CI runs, in CI's order
	pnpm check

lint:
	pnpm lint

typecheck:
	pnpm typecheck

test:
	pnpm test

e2e:
	pnpm test:e2e

build:
	pnpm build

dev:
	pnpm dev
