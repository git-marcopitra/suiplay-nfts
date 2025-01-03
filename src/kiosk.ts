import {
  rpcClient,
  log,
  graphQLClient,
  writeFile,
  keyValueGroupedBy,
} from "./utils";

import { queryNFTObjects } from "./query";
import { pathOr } from "ramda";

interface GetNFTObjectsArgs {
  objectType: string;
  after: string | null;
  first: number;
}

export const getNFTObjects = async ({
  objectType,
  after,
  first,
}: GetNFTObjectsArgs) => {
  const result = await graphQLClient.query({
    query: queryNFTObjects,
    variables: { type: objectType, first, after },
  });

  return {
    pageInfo: {
      endCursor: pathOr(
        "",
        ["data", "objects", "pageInfo", "endCursor"],
        result
      ),
      hasNextPage: pathOr(
        false,
        ["data", "objects", "pageInfo", "hasNextPage"],
        result
      ),
    },
    nfts: pathOr([], ["data", "objects", "nodes"], result).map((node) =>
      pathOr("", ["asMoveObject", "contents", "json", "id"], node)
    ),
  };
};

(async () => {
  let after = null;
  const results: string[] = [];

  do {
    const { nfts, pageInfo } = await getNFTObjects({
      objectType:
        "0x8f74a7d632191e29956df3843404f22d27bd84d92cca1b1abde621d033098769::rootlet::Rootlet",
      after,
      first: 50,
    });

    results.push(...nfts);
    after = pageInfo.endCursor;
  } while (after);

  log(`>> NFTs Loaded :: ${results.length}`);

  let loadedItems = 0;
  let owners: string[] = [];

  do {
    const ids = results.slice(loadedItems, loadedItems + 50);

    const kioskItems = await rpcClient
      .multiGetObjects({
        ids,
        options: { showOwner: true },
      })
      .then((data) =>
        data.map(({ data }) => (data?.owner as any)!["ObjectOwner"])
      );

    const kioskWrappers = await rpcClient
      .multiGetObjects({
        ids: kioskItems,
        options: { showOwner: true },
      })
      .then((data) =>
        data.map(({ data }) => (data?.owner as any)!["ObjectOwner"])
      );

    const [uniqueKioskWrappers, groupedKioskWrappers] =
      keyValueGroupedBy(kioskWrappers);

    const nftHolders = await rpcClient
      .multiGetObjects({
        ids: uniqueKioskWrappers,
        options: { showContent: true },
      })
      .then((data) =>
        data.reduce(
          (acc, { data }, index) => ({
            ...acc,
            [uniqueKioskWrappers[index]]: (data?.content as any)!["fields"][
              "owner"
            ] as string,
          }),
          {} as Record<string, string>
        )
      );

    const values = groupedKioskWrappers.map((id) => nftHolders[id]);

    owners.push(...values);

    loadedItems += 50;
  } while (results.length > loadedItems);

  log(`>> Owners loaded :: ${owners.length}`);

  const file = {
    lastUpdateAt: Date.now(),
    holders: owners,
  };

  await writeFile(
    `${__dirname}/../data/rootlets-nfts.json`,
    JSON.stringify(file, null, 2)
  );
})();
