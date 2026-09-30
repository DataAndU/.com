"use client";

/** Quick picks for a datetime-local field: tap instead of typing a date. */
function toLocalInput(date: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function options() {
  const now = new Date();
  const inHour = new Date(now.getTime() + 60 * 60 * 1000);
  inHour.setMinutes(inHour.getMinutes() < 30 ? 30 : 60, 0, 0);
  const evening = new Date(now); evening.setHours(18, 0, 0, 0);
  const tomorrowMorning = new Date(now); tomorrowMorning.setDate(now.getDate() + 1); tomorrowMorning.setHours(10, 0, 0, 0);
  const tomorrowEvening = new Date(tomorrowMorning); tomorrowEvening.setHours(18, 0, 0, 0);
  const picks: [string, Date][] = [["In 1 hour", inHour]];
  if (evening.getTime() > inHour.getTime()) picks.push(["Today 6 PM", evening]);
  picks.push(["Tomorrow 10 AM", tomorrowMorning], ["Tomorrow 6 PM", tomorrowEvening]);
  return picks;
}

export function TimeChips({ value, onPick }: { value: string; onPick: (value: string) => void }) {
  return (
    <div className="mb-2 flex flex-wrap gap-1.5">
      {options().map(([label, date]) => {
        const v = toLocalInput(date);
        return (
          <button key={label} type="button" onClick={() => onPick(v)} aria-pressed={value === v}
            className={`rounded-full border px-3 py-1 text-xs font-medium ${value === v ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:border-primary"}`}>
            {label}
          </button>
        );
      })}
    </div>
  );
}
