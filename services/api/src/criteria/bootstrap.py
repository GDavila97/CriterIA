from dataclasses import dataclass

from criteria.adapters.agents.factory import AgentFactory
from criteria.adapters.agents.runner import ModelBinding
from criteria.adapters.llm.catalog import ModelCatalog
from criteria.adapters.llm.registry import ProviderRegistry
from criteria.adapters.memory.checkpointer import MemoryCheckpointer
from criteria.adapters.system_clock import SystemClock
from criteria.application.runs import RunService
from criteria.config import Settings
from criteria.domain.run_config import ProviderSelection
from criteria.ports.agents import AgentSet
from criteria.ports.clock import Clock


@dataclass
class Container:
    settings: Settings
    registry: ProviderRegistry
    clock: Clock
    service: RunService

    def binding(self, selection: ProviderSelection) -> ModelBinding:
        registry = self.registry
        return ModelBinding(
            model=registry.model(selection),
            label=selection.etiqueta,
            settings=registry.model_settings(selection),
            cost_usd=lambda tokens_in, tokens_out: registry.cost_usd(
                selection, tokens_in, tokens_out
            ),
        )

    def agents(self, generacion: ProviderSelection, juez: ProviderSelection) -> AgentSet:
        settings = self.settings
        factory = AgentFactory(
            settings.prompts_dir, settings.prompt_version, settings.judge_version, self.clock
        )
        return factory.build(self.binding(generacion), self.binding(juez))


def build_container(settings: Settings) -> Container:
    catalog = ModelCatalog.load(settings.models_file)
    return Container(
        settings=settings,
        registry=ProviderRegistry(settings, catalog),
        clock=SystemClock(),
        service=RunService(MemoryCheckpointer()),
    )
