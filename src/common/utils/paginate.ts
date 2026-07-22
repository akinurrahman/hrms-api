interface PaginateParams {
  page?: number;
  limit?: number;
}

export function getPaginationParams({ page = 1, limit = 10 }: PaginateParams) {
  const safeLimit = Math.min(limit, 100);
  return {
    skip: (page - 1) * safeLimit,
    take: safeLimit,
  };
}

export function buildPaginatedResponse<T>(
  data: T[],
  total: number,
  page: number=1,
  limit: number=10,
  stats?: Record<string, unknown>,
) {
  const totalPages = Math.ceil(total / limit);

  return {
    data,
    pagination: {
      total,
      page,
      limit,
      totalPages,
      hasNext: page < totalPages,
      hasPrevious: page > 1,
    },
    ...(stats && { stats }),
  };
}