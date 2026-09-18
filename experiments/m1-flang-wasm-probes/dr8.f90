program dr8
  implicit none
  real :: x
  double precision :: d
  print '(a,i0)', "kind(1.0)   = ", kind(1.0)
  print '(a,i0)', "kind(1.0d0) = ", kind(1.0d0)
  print '(a,i0)', "kind(x)     = ", kind(x)
  print '(a,i0)', "kind(d)     = ", kind(d)
  x = 1.0/3.0
  print '(a,es24.17)', "1/3 as default real = ", x
  d = 1.0d0/3.0d0
  print '(a,es24.17)', "1/3 as dble         = ", d
end program
