! Time the three LAPACK/BLAS calls xtb's SCF diagonalisation actually makes
! (src/mctc/lapack/eigensolve.f90): dsygst + dsyevd + dtrsm on an nao x nao matrix.
program lap
   implicit none
   integer, parameter :: wp = kind(1.0d0)
   integer :: n, i, j, info, lwork, liwork, rep, nrep
   real(wp), allocatable :: a(:,:), b(:,:), a0(:,:), w(:), work(:)
   integer, allocatable :: iwork(:)
   real(wp) :: t0, t1, best
   character(len=32) :: arg
   integer :: sizes(6) = [50, 100, 150, 200, 250, 300]

   do i = 1, 6
      n = sizes(i)
      nrep = max(3, 2000000 / (n*n))
      allocate(a(n,n), b(n,n), a0(n,n), w(n))
      call fill(a0, n)
      call fillspd(b, n)
      lwork = 1 + 6*n + 2*n*n
      liwork = 3 + 5*n
      allocate(work(lwork), iwork(liwork))
      best = 1.0e30_wp
      do rep = 1, nrep
         a = a0
         call cpu_time(t0)
         call dsygst(1, 'U', n, a, n, b, n, info)
         call dsyevd('V', 'U', n, a, n, w, work, lwork, iwork, liwork, info)
         call dtrsm('L', 'U', 'N', 'N', n, n, 1.0_wp, b, n, a, n)
         call cpu_time(t1)
         best = min(best, t1 - t0)
      end do
      write(*,'(A,I5,A,F12.4,A,I6,A,F14.8)') 'n=', n, '  best_ms=', best*1000.0_wp, &
         & '  reps=', nrep, '  w1=', w(1)
      deallocate(a, b, a0, w, work, iwork)
   end do
contains
   subroutine fill(m, n)
      real(wp), intent(out) :: m(:,:)
      integer, intent(in) :: n
      integer :: i, j
      do j = 1, n
         do i = 1, n
            m(i,j) = sin(real(i*j, wp)*0.001_wp)
         end do
      end do
      do j = 1, n
         do i = 1, j
            m(j,i) = m(i,j)
         end do
      end do
   end subroutine
   subroutine fillspd(m, n)
      real(wp), intent(out) :: m(:,:)
      integer, intent(in) :: n
      integer :: i, j, info
      call fill(m, n)
      do i = 1, n
         m(i,i) = m(i,i) + real(n, wp)
      end do
      call dpotrf('U', n, m, n, info)
   end subroutine
end program
