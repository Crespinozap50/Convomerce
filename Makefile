.PHONY: infra-up infra-stop infra-down infra-restart db-up db-stop db-down db-restart db-reset db-migrate db-seed db-test db-psql db-backup db-restore backend-build backend-test backend-test-integration backend-eval backend-start backend-lint backend-format frontend-build frontend-start frontend-lint frontend-format lint format

infra-up:
	docker compose up -d --wait postgres redis

infra-stop:
	docker compose stop postgres redis

infra-down:
	docker compose down

infra-restart:
	docker compose restart postgres redis
	docker compose up -d --wait postgres redis

db-up:
	docker compose up -d --wait postgres

db-stop:
	docker compose stop postgres

db-down:
	docker compose down

db-restart:
	docker compose restart postgres
	docker compose up -d --wait postgres

db-reset:
	docker compose down --volumes
	docker compose up -d --wait postgres
	./database/scripts/migrate.sh
	./database/scripts/seed.sh

db-migrate:
	./database/scripts/migrate.sh

db-seed:
	./database/scripts/seed.sh

db-test:
	./database/scripts/test.sh

db-psql:
	docker compose exec postgres psql -U postgres -d whatsapp_commerce

db-backup:
	./database/scripts/backup.sh

db-restore:
	./database/scripts/restore.sh "$(FILE)"

backend-test:
	cd backend && npm test

backend-build:
	cd backend && npm run build

backend-test-integration:
	cd backend && npm run test:integration

backend-eval:
	cd backend && npm run eval:conversations

backend-start:
	cd backend && npm run start:dev

backend-lint:
	cd backend && npm run lint

backend-format:
	cd backend && npm run format

frontend-build:
	cd frontend && npm run build

frontend-start:
	cd frontend && npm run dev

frontend-lint:
	cd frontend && npm run lint

frontend-format:
	cd frontend && npm run format

lint: backend-lint frontend-lint

format: backend-format frontend-format
