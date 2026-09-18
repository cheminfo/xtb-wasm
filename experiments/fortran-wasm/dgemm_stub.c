#include <stddef.h>
/* naive column-major dgemm, no-transpose only; flang passes hidden string lengths last */
void dgemm_(const char* ta, const char* tb, const int* m, const int* n, const int* k,
            const double* alpha, const double* A, const int* lda,
            const double* B, const int* ldb, const double* beta,
            double* C, const int* ldc, size_t la, size_t lb) {
  for (int j = 0; j < *n; ++j)
    for (int i = 0; i < *m; ++i) {
      double s = 0.0;
      for (int p = 0; p < *k; ++p) s += A[i + p*(*lda)] * B[p + j*(*ldb)];
      C[i + j*(*ldc)] = (*alpha)*s + (*beta)*C[i + j*(*ldc)];
    }
}
