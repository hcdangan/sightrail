"""Typed API contracts.

Every request body, result payload and job envelope living here keeps the HTTP
layer and the domain layer in sync: routers validate input with these models and
the OpenAPI schema shipped to the UI is generated from them.
"""
