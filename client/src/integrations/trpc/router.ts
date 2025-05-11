import type { TRPCRouterRecord } from "@trpc/server";

import { createTRPCRouter, publicProcedure } from "./init";

const peopleRouter = {
	list: publicProcedure.query(async () =>
		fetch("https://swapi.dev/api/people")
			.then((res) => res.json())
			.then((d) => d.results as { name: string }[]),
	),
} satisfies TRPCRouterRecord;

export const trpcRouter = createTRPCRouter({
	people: peopleRouter,
});
export type TRPCRouter = typeof trpcRouter;
