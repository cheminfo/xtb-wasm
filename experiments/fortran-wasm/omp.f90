program main
  implicit none
  integer, parameter :: n = 1000
  double precision :: a(n), s
  integer :: i
  !$omp parallel do
  do i = 1, n
     a(i) = dble(i)
  end do
  !$omp end parallel do
  s = 0.0d0
  !$omp parallel do reduction(+:s)
  do i = 1, n
     s = s + a(i)
  end do
  !$omp end parallel do
  print "(a,f14.2)", " omp sum=", s
end program
