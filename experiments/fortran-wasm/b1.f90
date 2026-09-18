module m1
  implicit none
  type :: p
     real :: r = 1.0
  end type
contains
  function mk(x) result(c)
    real, intent(in) :: x
    type(p), allocatable :: c
    allocate(c); c%r = x
  end function
end module
program main
  use m1
  type(p), allocatable :: c
  c = mk(2.0)
  print *, "b1 r=", c%r
end program
