module m3
  type :: box
     real, allocatable :: data(:)
     character(len=:), allocatable :: nm
  end type
end module
program main
  use m3
  type(box) :: x
  allocate(x%data(4)); x%data = [1.,2.,3.,4.]
  x%nm = "boxname"
  print *, "b3 ", x%nm, sum(x%data)
end program
