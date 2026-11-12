from dataclasses import asdict
from importlib.metadata import version
from typing import Annotated, cast
from uuid import UUID

from fastapi import APIRouter, Header, Request, Response, status
from fastapi.responses import StreamingResponse

from criteria.adapters.http import sse
from criteria.adapters.http.dependencies import CurrentUser, VerifiedUser
from criteria.adapters.http.schemas import (
    AgentPromptsBody,
    AgentsBody,
    AgentsPlanBody,
    CatalogBody,
    CredentialBody,
    CredentialPutBody,
    EvaluationBody,
    HealthBody,
    HistoryDeletedBody,
    HistoryItemBody,
    HistorySummaryBody,
    ModelPlanBody,
    RunCreateBody,
    RunCreatedBody,
    SettingsBody,
    UsageBody,
)
from criteria.adapters.http.services import ApiServices, services
from criteria.adapters.llm.ssrf import validate_endpoint_url
from criteria.application.errors import NotFoundError
from criteria.application.report import judge_agreement
from criteria.application.run_api import AgentParams, RunRequest
from criteria.domain.approval import RespuestaHumana
from criteria.domain.artifacts import CRITERIOS, Criterio
from criteria.domain.eval_metrics import Agreement, Estimate
from criteria.domain.events import ProveedorId
from criteria.domain.run_config import RolAgente
from criteria.ports.stores import ModelPlan, UserSettings

router = APIRouter()


def _services(request: Request) -> ApiServices:
    return services(request)


def _plan(plan: ModelPlan) -> ModelPlanBody:
    return ModelPlanBody(
        proveedor=plan.proveedor,
        modelo=plan.modelo,
        clave=plan.clave,
        temperatura=plan.temperatura,
        max_tokens=plan.max_tokens,
    )


def _run_request(body: RunCreateBody) -> RunRequest:
    agentes = body.agentes.model_dump(exclude_none=True) if body.agentes else {}
    return RunRequest(
        **body.model_dump(exclude={"agentes"}),
        agentes={cast(RolAgente, rol): AgentParams(**params) for rol, params in agentes.items()},
    )


@router.get("/health", response_model=HealthBody, tags=["salud"])
async def health() -> HealthBody:
    return HealthBody(status="ok", version=version("criteria"))


@router.post(
    "/runs", response_model=RunCreatedBody, status_code=status.HTTP_201_CREATED, tags=["corridas"]
)
async def create_run(body: RunCreateBody, user: VerifiedUser, request: Request) -> RunCreatedBody:
    created = await _services(request).runs.create(user.user_id, _run_request(body))
    return RunCreatedBody(
        run_id=created.run_id,
        generacion=_plan(created.generacion),
        juez=_plan(created.juez),
        juez_mismo_proveedor=created.juez_mismo_proveedor,
        costo_estimado_usd=created.costo_estimado_usd,
        costo_servidor_usd=created.costo_servidor_usd,
        agentes=AgentsPlanBody(**{rol: _plan(plan) for rol, plan in created.agentes.items()}),
        max_rondas=created.max_rondas,
        guardar_historial=created.guardar_historial,
    )


@router.get("/runs/{run_id}/stream", tags=["corridas"], response_class=StreamingResponse)
async def stream_run(
    run_id: UUID,
    user: VerifiedUser,
    request: Request,
    last_event_id: Annotated[str | None, Header()] = None,
) -> StreamingResponse:
    events = await _services(request).runs.open_stream(
        user.user_id, run_id, sse.parse_last_event_id(last_event_id)
    )
    return StreamingResponse(
        sse.encode(events),
        media_type="text/event-stream",
        headers={"cache-control": "no-store", "x-accel-buffering": "no"},
    )


@router.post("/runs/{run_id}/approval", status_code=status.HTTP_204_NO_CONTENT, tags=["corridas"])
async def approve_run(
    run_id: UUID, body: RespuestaHumana, user: VerifiedUser, request: Request
) -> Response:
    await _services(request).runs.approve(user.user_id, run_id, body)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.put("/me/credentials/{provider}", response_model=CredentialBody, tags=["claves"])
async def save_credential(
    provider: ProveedorId, body: CredentialPutBody, user: CurrentUser, request: Request
) -> CredentialBody:
    # Checked here too, so no stored URL ever skipped the outbound rules.
    base_url = str(validate_endpoint_url(str(body.base_url))) if body.base_url else None
    saved = await _services(request).credentials.save(
        user.user_id, provider, body.api_key, base_url
    )
    return CredentialBody(
        proveedor=saved.provider,
        last4=saved.last4,
        validated_at=saved.validated_at,
        base_url=saved.base_url,
    )


@router.get("/me/credentials", response_model=list[CredentialBody], tags=["claves"])
async def list_credentials(user: CurrentUser, request: Request) -> list[CredentialBody]:
    return [
        CredentialBody(
            proveedor=item.provider,
            last4=item.last4,
            validated_at=item.validated_at,
            base_url=item.base_url,
        )
        for item in await _services(request).credentials.list(user.user_id)
    ]


@router.delete(
    "/me/credentials/{provider}", status_code=status.HTTP_204_NO_CONTENT, tags=["claves"]
)
async def delete_credential(provider: ProveedorId, user: CurrentUser, request: Request) -> Response:
    if not await _services(request).credentials.delete(user.user_id, provider):
        raise NotFoundError("credential not found")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/me/settings", response_model=SettingsBody, tags=["ajustes"])
async def get_settings(user: CurrentUser, request: Request) -> SettingsBody:
    return SettingsBody(**asdict(await _services(request).accounts.settings(user.user_id)))


@router.put("/me/settings", response_model=SettingsBody, tags=["ajustes"])
async def put_settings(body: SettingsBody, user: CurrentUser, request: Request) -> SettingsBody:
    saved = await _services(request).accounts.update_settings(
        user.user_id, UserSettings(**body.model_dump())
    )
    return SettingsBody(**asdict(saved))


@router.get("/me/usage", response_model=UsageBody, tags=["ajustes"])
async def usage(user: CurrentUser, request: Request) -> UsageBody:
    summary = await _services(request).accounts.usage(user.user_id)
    return UsageBody(
        corridas_hora=summary.runs_last_hour,
        limite_hora=summary.runs_per_hour,
        corridas_dia=summary.runs_today,
        limite_dia=summary.runs_per_day,
    )


@router.get("/agents", response_model=AgentsBody, tags=["catalogo"])
async def agents(user: CurrentUser, request: Request) -> AgentsBody:
    guide = _services(request).accounts.agents()
    return AgentsBody(
        version_prompts=guide.prompts.version_prompts,
        version_juez=guide.prompts.version_juez,
        prompts=AgentPromptsBody.model_validate(dict(guide.prompts.prompts)),
        temperatura_maxima=guide.temperatura_maxima,
        max_tokens_minimo=guide.max_tokens_minimo,
        max_tokens_maximo=guide.max_tokens_maximo,
        rondas_maximas=guide.rondas_maximas,
    )


@router.get("/catalog", response_model=CatalogBody, tags=["catalogo"])
async def catalog(user: CurrentUser, request: Request) -> CatalogBody:
    return CatalogBody.model_validate(
        asdict(await _services(request).accounts.catalog(user.user_id))
    )


@router.get("/me/runs", response_model=list[HistorySummaryBody], tags=["historial"])
async def history(user: CurrentUser, request: Request) -> list[HistorySummaryBody]:
    accounts = _services(request).accounts
    items = await accounts.history(user.user_id)
    return [
        HistorySummaryBody(
            **asdict(item), model_display_name=accounts.display_name(item.provider, item.model)
        )
        for item in items
    ]


@router.get("/me/runs/{run_id}", response_model=HistoryItemBody, tags=["historial"])
async def history_item(run_id: UUID, user: CurrentUser, request: Request) -> HistoryItemBody:
    accounts = _services(request).accounts
    item = await accounts.history_item(user.user_id, run_id)
    return HistoryItemBody(
        **asdict(item),
        model_display_name=accounts.display_name(item.provider, item.model),
        judge_display_name=accounts.judge_display_name(item.judge_model),
    )


@router.delete("/me/runs", response_model=HistoryDeletedBody, tags=["historial"])
async def clear_history(user: CurrentUser, request: Request) -> HistoryDeletedBody:
    return HistoryDeletedBody(deleted=await _services(request).accounts.clear_history(user.user_id))


@router.get("/evaluation", response_model=EvaluationBody, tags=["evaluacion"])
async def evaluation(request: Request, response: Response) -> EvaluationBody:
    response.headers["cache-control"] = "public, max-age=60"
    services = _services(request)
    batches = await services.evaluation.batches()
    agreement = judge_agreement(_criteria_pairs(await services.evaluation.judge_pairs()))
    return EvaluationBody.model_validate(
        {
            "lotes": [
                {
                    **{k: v for k, v in batch.items() if k != "display_name"},
                    # The catalog name, or the one the batch recorded for a model it no longer has.
                    "model_display_name": batch.get("display_name")
                    or services.accounts.display_name(batch["provider"], batch["model"]),
                }
                for batch in batches
            ],
            "acuerdo_juez": None if agreement is None else _agreement_body(agreement.total),
        }
    )


def _criteria_pairs(pairs: list[tuple[str, int, int]]) -> list[tuple[Criterio, int, int]]:
    return [(c, j, h) for criterio, j, h in pairs for c in CRITERIOS if c == criterio]


def _interval(estimate: Estimate) -> dict[str, float | None]:
    return {"valor": estimate.value, "bajo": estimate.low, "alto": estimate.high}


def _agreement_body(a: Agreement) -> dict[str, object]:
    return {
        "pares": a.pairs,
        "kappa": _interval(a.kappa),
        "spearman": _interval(a.spearman),
        "exacto": _interval(a.exact),
        "mas_menos_uno": _interval(a.within_one),
        "juez_menos_humano": _interval(a.judge_minus_human),
    }
