# Social Media Microservices

A Node.js microservices backend for a social media application.

This repository contains:
- API Gateway (routing, auth validation, proxying, gateway-level rate limiting)
- Identity Service (register/login/token refresh/logout)
- Post Service (create/read/delete posts, Redis caching, event publishing)
- Media Service (file upload to Cloudinary, media storage, media cleanup on post deletion)
- Search Service (full-text search index, event-driven index updates)
- Redis (caching and distributed rate limiting)
- RabbitMQ (event bus)

## Architecture Overview

Client requests enter through `api-gateway` (`/v1/*`), then are proxied to internal services:
- `/v1/auth` -> identity-service (`/api/auth`)
- `/v1/posts` -> post-service (`/api/posts`)
- `/v1/media` -> media-service (`/api/media`)
- `/v1/search` -> search-service (`/api/search`)

Event flow:
- `post-service` publishes `post.created` and `post.deleted` to RabbitMQ exchange `social_events`.
- `search-service` consumes those events to keep search index in sync.
- `media-service` consumes `post.deleted` to delete associated media.

## Tech Stack

- Node.js + Express (CommonJS)
- MongoDB + Mongoose
- Redis (`ioredis`) for cache/rate limit backing store
- RabbitMQ (`amqplib`) for asynchronous events
- JWT (`jsonwebtoken`)
- Cloudinary for media storage
- Joi for input validation

## Repository Structure

```text
social-media-microservices/
  api-gateway/
  identity-service/
  post-service/
  media-service/
  search-service/
  docker-compose.yml
```

## Prerequisites

- Node.js 18+
- npm 9+
- Docker + Docker Compose
- MongoDB instance(s)
- Cloudinary account (for media-service)

## Environment Variables

Create `.env` files inside each service folder.

### api-gateway/.env

```env
PORT=3000
JWT_SECRET_KEY=your_jwt_secret
IDENTITY_SERVICE_URL=http://identity-service:3001
POST_SERVICE_URL=http://post-service:3002
MEDIA_SERVICE_URL=http://media-service:3003
SEARCH_SERVICE_URL=http://search-service:3004
REDIS_URL=redis://redis:6379
RABBITMQ_URL=amqp://rabbitmq:5672
```

For local non-Docker runs, service URLs can be:
- `IDENTITY_SERVICE_URL=http://localhost:3001`
- `POST_SERVICE_URL=http://localhost:3002`
- `MEDIA_SERVICE_URL=http://localhost:3003`
- `SEARCH_SERVICE_URL=http://localhost:3004`

### identity-service/.env

```env
PORT=3001
MONGODB_URI=mongodb://localhost:27017/social_identity
JWT_SECRET_KEY=your_jwt_secret
REDIS_URL=redis://localhost:6379
RABBITMQ_URL=amqp://localhost:5672
```

### post-service/.env

```env
PORT=3002
MONGODB_URI=mongodb://localhost:27017/social_posts
REDIS_URL=redis://localhost:6379
RABBITMQ_URL=amqp://localhost:5672
```

### media-service/.env

```env
PORT=3003
MONGODB_URI=mongodb://localhost:27017/social_media
REDIS_URL=redis://localhost:6379
RABBITMQ_URL=amqp://localhost:5672
cloud_name=your_cloudinary_cloud_name
api_key=your_cloudinary_api_key
api_secret=your_cloudinary_api_secret
```

### search-service/.env

```env
PORT=3004
MONGODB_URI=mongodb://localhost:27017/social_search
REDIS_URL=redis://localhost:6379
RABBITMQ_URL=amqp://localhost:5672
```

## Run with Docker Compose

From repository root:

```bash
docker compose up --build
```

Notes:
- `docker-compose.yml` maps gateway to `localhost:3000`.
- Redis is mapped to `localhost:6379`.
- RabbitMQ is mapped to `localhost:5672`.
- RabbitMQ management UI is available at `http://localhost:15672`.

## Run Services Locally (without Docker)

1. Start Redis and RabbitMQ locally.
2. Ensure MongoDB connection strings are valid.
3. Install dependencies and run each service in separate terminals:

```bash
cd api-gateway && npm install && npm run dev
cd identity-service && npm install && npm run dev
cd post-service && npm install && npm run dev
cd media-service && npm install && npm run dev
cd search-service && npm install && npm run dev
```

## API Endpoints (via API Gateway)

Base URL: `http://localhost:3000`

### Identity

- `POST /v1/auth/register`
- `POST /v1/auth/login`
- `POST /v1/auth/refresh-token`
- `POST /v1/auth/logout`

Register request body:

```json
{
  "username": "john_doe",
  "email": "john@example.com",
  "password": "secret123"
}
```

Login response includes `accessToken` and `refreshToken`.

### Posts (requires `Authorization: Bearer <accessToken>`)

- `POST /v1/posts/create-post`
- `GET /v1/posts/all-posts?page=1&limit=10`
- `GET /v1/posts/:id`
- `DELETE /v1/posts/:id`

Create post body:

```json
{
  "content": "My first post",
  "mediaIds": ["<mediaId>"]
}
```

### Media (requires `Authorization: Bearer <accessToken>`)

- `POST /v1/media/upload` (multipart form-data with field name `file`)
- `GET /v1/media/get`

### Search (requires `Authorization: Bearer <accessToken>`)

- `GET /v1/search/posts?query=keyword`

## Service Ports

Default internal ports:
- API Gateway: `3000`
- Identity Service: `3001`
- Post Service: `3002`
- Media Service: `3003`
- Search Service: `3004`

## Rate Limiting

Each service applies Redis-backed rate limiting. Limits differ by service and endpoint (global + route-specific limiters are implemented in service `src/server.js` files).

## Current Limitations

- No automated tests are configured (`npm test` currently returns placeholder scripts).
- No centralized API schema/OpenAPI spec.
- No root `.env.example` yet.

## Quick Smoke Test

1. Register user -> `POST /v1/auth/register`
2. Login user -> `POST /v1/auth/login`
3. Use returned access token to:
   - upload media (`/v1/media/upload`)
   - create post (`/v1/posts/create-post`)
4. Search for text from post -> `GET /v1/search/posts?query=...`

## License

ISC (per service `package.json`).
