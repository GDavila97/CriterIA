from typing import Annotated

from fastapi import Depends, Header, Request

from criteria.adapters.http.errors import ForbiddenError
from criteria.adapters.http.middleware import user_ref
from criteria.ports.auth import AuthError, Principal, TokenVerifier

BEARER = "bearer "


def _verifier(request: Request) -> TokenVerifier:
    verifier: TokenVerifier = request.app.state.services.verifier
    return verifier


async def current_user(
    request: Request, authorization: Annotated[str | None, Header()] = None
) -> Principal:
    if authorization is None or not authorization.lower().startswith(BEARER):
        raise AuthError
    principal = await _verifier(request).verify(authorization[len(BEARER) :].strip())
    request.state.user_ref = user_ref(principal.user_id)
    return principal


async def verified_user(
    request: Request, user: Annotated[Principal, Depends(current_user)]
) -> Principal:
    required: bool = request.app.state.services.require_verified_email
    if required and not user.email_verified:
        raise ForbiddenError("correo_no_verificado")
    return user


CurrentUser = Annotated[Principal, Depends(current_user)]
VerifiedUser = Annotated[Principal, Depends(verified_user)]
