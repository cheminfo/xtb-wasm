program main
  implicit none
  integer, parameter :: n = 3
  double precision :: a(n,n), b(n,n), c(n,n)
  integer :: i, j
  external :: dgemm
  do j = 1, n
     do i = 1, n
        a(i,j) = dble(i + j)
        b(i,j) = dble(i - j)
        c(i,j) = 0.0d0
     end do
  end do
  call dgemm('N','N', n, n, n, 1.0d0, a, n, b, n, 0.0d0, c, n)
  print '(a,9f9.2)', " C=", c
end program
