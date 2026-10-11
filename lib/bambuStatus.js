export function statusSignature(status) {
	if (!status) {
		return '';
	};

	const job = status.job ?? {};
	const temps = status.temperatures ?? {};

	return JSON.stringify([
		status.connected === true,
		status.printer?.name ?? '',
		status.printer?.model ?? '',
		job.state ?? '',
		job.file ?? '',
		job.progress ?? null,
		job.remaining_min ?? null,
		job.layer ?? null,
		job.total_layers ?? null,
		job.speed ?? '',
		job.error_code ?? 0,
		temps.nozzle ?? null,
		temps.nozzle_target ?? null,
		temps.bed ?? null,
		temps.bed_target ?? null,
		temps.chamber ?? null,
		(status.filament?.ams ?? []).map(slot => [slot.type, slot.color, slot.active].join(':')).join(','),
	]);
};
