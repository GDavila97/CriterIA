from collections.abc import Awaitable, Callable
from dataclasses import dataclass

from fastapi import Request

from criteria.application.accounts import AccountService
from criteria.application.credentials import CredentialService
from criteria.application.run_api import RunApplication
from criteria.ports.auth import TokenVerifier
from criteria.ports.stores import EvaluationReader


@dataclass
class ApiServices:
    verifier: TokenVerifier
    runs: RunApplication
    credentials: CredentialService
    accounts: AccountService
    evaluation: EvaluationReader
    startup: Callable[[], Awaitable[None]]
    shutdown: Callable[[], Awaitable[None]]
    require_verified_email: bool = True


def services(request: Request) -> ApiServices:
    found: ApiServices = request.app.state.services
    return found
